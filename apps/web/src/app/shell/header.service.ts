import {
  DestroyRef,
  Injectable,
  Signal,
  effect,
  isSignal,
  signal,
} from '@angular/core';

/** Simple declarative content a page contributes to the single {@link AppHeader}. */
export interface HeaderContent {
  /** The small label above the title (e.g. "Library"). */
  readonly eyebrow?: string;
  /** The page's heading shown in the header (e.g. "Your maps"). */
  readonly title?: string;
}

/**
 * The stateful, signal-based half of the header's hybrid content mechanism
 * (ADR-0015): a page sets simple declarative text on activation and the
 * {@link AppHeader} reads it back through a signal. Rich, interactive header
 * content goes through the named `header` router-outlet instead.
 *
 * A page hands its own {@link DestroyRef} to {@link set}, so the content is
 * withdrawn automatically when the page is destroyed — no page has to remember a
 * matching `clear()` in `ngOnDestroy`. The single content slot is owned by the
 * last setter: a page that has already been superseded never clears its
 * successor's content on the way out, so the header stays correct regardless of
 * the order in which Angular activates and destroys routed components.
 */
@Injectable({ providedIn: 'root' })
export class HeaderService {
  private readonly _content = signal<HeaderContent | null>(null);
  /** The active page's declarative content, or `null` when none. */
  readonly content: Signal<HeaderContent | null> = this._content.asReadonly();

  /**
   * Identifies the page that currently owns the slot. A destroy callback only
   * clears the content if its page is still the owner, so a late teardown can't
   * wipe content a newer page has since set.
   */
  private owner: object | null = null;

  /**
   * Contribute the active page's declarative header content. Pass a plain
   * {@link HeaderContent} for static text, or a `Signal<HeaderContent>` (e.g. a
   * `computed` over translated headings) for content that should track a live
   * language switch — the service owns the subscription so each page contributes
   * once instead of wiring its own effect, and exactly one teardown is
   * registered however often the content changes. The content is cleared
   * automatically when `destroyRef` fires (the page is destroyed), and a
   * superseded page's teardown is ignored.
   *
   * When a `Signal` is passed, call this from an injection context (a page
   * constructor): the reactive subscription is an `effect` tied to that
   * context's lifetime.
   */
  set(content: HeaderContent | Signal<HeaderContent>, destroyRef: DestroyRef): void {
    const token = {};
    this.owner = token;

    if (isSignal(content)) {
      // Read the signal in an effect so the slot re-renders on a language flip.
      // The ownership guard keeps a not-yet-destroyed predecessor's effect from
      // clobbering a successor that has already taken the slot.
      effect(() => {
        const value = content();
        if (this.owner === token) this._content.set(value);
      });
    } else {
      this._content.set(content);
    }

    destroyRef.onDestroy(() => {
      if (this.owner === token) {
        this.owner = null;
        this._content.set(null);
      }
    });
  }
}
