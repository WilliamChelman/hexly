import { DestroyRef, inject, Injectable, InjectionToken, OnDestroy } from '@angular/core';

/**
 * Dispatch layers, strongest claim first (ADR-0063): `modal` while a modal scope
 * is held, `editable` while a text field is focused, then `surface` (the active
 * surface editor) before `global` (app-wide chords).
 */
export type ShortcutLayer = 'modal' | 'editable' | 'surface' | 'global';

export interface ShortcutRegistration {
  layer: ShortcutLayer;
  /**
   * One or more chords: `'mod+z'`, `'mod+shift+z'`, `'ctrl+y'`, `'escape'`,
   * `'shift+arrowright'`, or a bare letter like `'v'`. `mod` is ⌘ on mac and
   * Ctrl elsewhere. Matching is exact on all four modifiers — `'v'` never fires
   * on Alt+V/Ctrl+V/Meta+V — and case-insensitive on `event.key`.
   */
  keys: string | string[];
  /** Extra gate evaluated at dispatch time; a `false` skips to the next candidate. */
  when?: () => boolean;
  /**
   * Run even while focus is in an editable target — for modifier chords (mod+K)
   * that must work mid-typing.
   */
  inEditable?: boolean;
  /** Return `false` for "didn't handle": dispatch falls through to the next candidate. */
  handler: (event: KeyboardEvent) => void | boolean;
}

/**
 * Whether `target` is a text field the user is typing into — the one shared
 * definition (it used to be copied per surface).
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || !!el.isContentEditable;
}

/**
 * Whether `target` is a focusable UI control (button, link, select, summary, or an
 * editable field) rather than the bare surface/body — so a surface's destructive
 * shortcuts (Delete/Backspace) never fire behind a focused control. Shared for the
 * same reason as {@link isEditableTarget}: each surface used to grow its own copy.
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === 'BUTTON' || tag === 'A' || tag === 'SELECT' || tag === 'SUMMARY' || isEditableTarget(el);
}

/**
 * Whether `mod` normalizes to ⌘ (metaKey) rather than Ctrl. A token so specs
 * can pin either platform instead of sniffing the test browser.
 */
export const IS_MAC_PLATFORM = new InjectionToken<boolean>('IS_MAC_PLATFORM', {
  factory: () => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    // userAgentData first: navigator.platform is deprecated and frozen on some browsers.
    const platform = nav.userAgentData?.platform ?? nav.platform ?? '';
    return /mac|iphone|ipad|ipod/i.test(platform);
  },
});

/** A chord parsed once at registration time, with `mod` already resolved per platform. */
interface Chord {
  readonly key: string;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly meta: boolean;
}

interface Entry {
  readonly reg: ShortcutRegistration;
  readonly chords: readonly Chord[];
}

/**
 * The app's single keyboard-shortcut dispatcher (ADR-0063): one lazily attached
 * `window` keydown listener that every surface registers into, instead of
 * per-surface listeners that cannot see each other.
 *
 * Dispatch, per keydown:
 * 1. While any modal scope is held ({@link pushModalScope}), only `modal`-layer
 *    registrations are considered; unmatched keys are left alone so native
 *    dialog behavior (typing, Escape-to-close) keeps working.
 * 2. Else, if the event target is editable ({@link isEditableTarget}), only
 *    `editable`-layer registrations plus those marked `inEditable` run.
 * 3. Else `surface`-layer registrations run before `global` ones, each layer in
 *    registration order.
 * The first candidate whose chord matches exactly, whose `when()` passes, and
 * whose handler does not return `false` wins; `preventDefault()` is called only
 * then, and dispatch stops. The editable gate of rule 2 also applies inside a
 * modal scope, so a modal-layer chord still needs `inEditable` to fire from a
 * dialog's input.
 */
@Injectable({ providedIn: 'root' })
export class ShortcutService implements OnDestroy {
  private readonly isMac = inject(IS_MAC_PLATFORM);
  private readonly entries: Entry[] = [];
  private modalCount = 0;
  private listening = false;

  /**
   * Register a shortcut. Returns the unregister function; when called in an
   * injection context, unregistering is also tied to the caller's DestroyRef.
   */
  register(reg: ShortcutRegistration): () => void {
    const keys = typeof reg.keys === 'string' ? [reg.keys] : reg.keys;
    const entry: Entry = { reg, chords: keys.map((k) => this.parseChord(k)) };
    this.entries.push(entry);
    this.attach();

    const unregister = () => {
      const index = this.entries.indexOf(entry);
      if (index >= 0) this.entries.splice(index, 1);
      if (this.entries.length === 0) this.detach();
    };

    let destroyRef: DestroyRef | null = null;
    try {
      destroyRef = inject(DestroyRef);
    } catch {
      // Outside an injection context the caller owns cleanup via the returned function.
    }
    destroyRef?.onDestroy(unregister);
    return unregister;
  }

  /**
   * Claim the keyboard for a modal: while any scope is held, only `modal`-layer
   * handlers run. Counted, so stacked dialogs each hold their own scope; the
   * returned pop is idempotent.
   */
  pushModalScope(): () => void {
    this.modalCount++;
    let popped = false;
    return () => {
      if (popped) return;
      popped = true;
      this.modalCount--;
    };
  }

  ngOnDestroy(): void {
    this.detach();
  }

  private attach(): void {
    if (this.listening) return;
    window.addEventListener('keydown', this.onKeydown);
    this.listening = true;
  }

  private detach(): void {
    if (!this.listening) return;
    window.removeEventListener('keydown', this.onKeydown);
    this.listening = false;
  }

  private readonly onKeydown = (event: KeyboardEvent): void => {
    for (const entry of this.candidates(isEditableTarget(event.target))) {
      if (!entry.chords.some((chord) => matchesChord(event, chord))) continue;
      if (entry.reg.when && !entry.reg.when()) continue;
      if (entry.reg.handler(event) === false) continue;
      event.preventDefault();
      return;
    }
  };

  /** The registrations eligible for this event, in dispatch order (see class doc). */
  private candidates(editable: boolean): readonly Entry[] {
    const editableGate = (e: Entry) => !editable || e.reg.layer === 'editable' || !!e.reg.inEditable;
    if (this.modalCount > 0) {
      return this.entries.filter((e) => e.reg.layer === 'modal' && editableGate(e));
    }
    if (editable) {
      return this.entries.filter((e) => e.reg.layer === 'editable' || e.reg.inEditable);
    }
    const inLayer = (layer: ShortcutLayer) => this.entries.filter((e) => e.reg.layer === layer);
    return [...inLayer('surface'), ...inLayer('global')];
  }

  private parseChord(spec: string): Chord {
    const parts = spec.toLowerCase().split('+');
    const key = parts.pop() ?? '';
    let ctrl = false;
    let alt = false;
    let shift = false;
    let meta = false;
    for (const part of parts) {
      switch (part) {
        case 'mod':
          if (this.isMac) meta = true;
          else ctrl = true;
          break;
        case 'ctrl':
          ctrl = true;
          break;
        case 'alt':
          alt = true;
          break;
        case 'shift':
          shift = true;
          break;
        case 'meta':
          meta = true;
          break;
        default:
          // A typo'd modifier would otherwise register a chord that can never fire.
          throw new Error(`Unknown shortcut modifier '${part}' in '${spec}'`);
      }
    }
    return { key, ctrl, alt, shift, meta };
  }
}

/**
 * Exact modifier matching: a bare-letter chord must not fire on Alt/Ctrl/Meta
 * variants (Alt+letter used to re-arm surface tools through the OS's dead-key path).
 */
function matchesChord(event: KeyboardEvent, chord: Chord): boolean {
  return (
    event.key.toLowerCase() === chord.key &&
    event.ctrlKey === chord.ctrl &&
    event.altKey === chord.alt &&
    event.shiftKey === chord.shift &&
    event.metaKey === chord.meta
  );
}
