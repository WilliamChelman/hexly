import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthScopedStorage } from '@hexly/web-core';

/** The panels that share the Content body's right dock. Exactly one shows, or none. */
export type RightPanel = 'outline' | 'references';

/** Per-user preference key (auth-scoped), so one user's choice never leaks to the next. */
const STORAGE_KEY = 'entity.rightPanel';

/** A stored value is only honoured if it still names a panel — an old or corrupt one opens nothing. */
function restore(stored: string | null): RightPanel | null {
  return stored === 'outline' || stored === 'references' ? stored : null;
}

/**
 * Which panel the Content body's right dock is showing (ADR-0013) — the note-view peer of
 * `HexMapStore.rightPanel`, and modelled the same way on purpose.
 *
 * The dock holds **one** panel slot beside a rail of toggles, so "at most one panel is open" is an
 * invariant of the dock, not a rule its callers must remember. Holding a boolean per panel would
 * let a second `toggle()` caller — a panel's own close button, a keyboard shortcut, a pair of
 * restored preference keys — set both true at once, rendering one panel behind the other while both
 * toggle buttons read as active. One discriminant makes that state unrepresentable.
 */
@Injectable()
export class RightDock {
  private readonly storage = inject(AuthScopedStorage);

  // Default closed; the last choice persists app-wide, per user, across reloads.
  private readonly _panel = signal(restore(this.storage.getItem(STORAGE_KEY)));

  /** The panel currently showing, or `null` when the dock is closed. */
  readonly panel = this._panel.asReadonly();

  /** Whether any panel is showing — what the reading column reserves its room for. */
  readonly isOpen = computed(() => this._panel() !== null);

  /** Show `panel`, closing whatever was showing; toggling the open one closes the dock. */
  toggle(panel: RightPanel): void {
    this._panel.update((open) => (open === panel ? null : panel));
    this.storage.setItem(STORAGE_KEY, this._panel() ?? '');
  }
}
