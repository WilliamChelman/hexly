import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthScopedStorage } from '@hexly/web-core';

/**
 * The panel the Content body's right dock holds. Once shared with References; References is a
 * page-owned Dock Panel now (ADR-0067), so the Outline is the sole remaining Content-View dock panel —
 * kept as a discriminant (not a boolean) for the Outline's own eventual move to the page Dock.
 */
export type RightPanel = 'outline';

/** Per-user preference key (auth-scoped), so one user's choice never leaks to the next. */
const STORAGE_KEY = 'entity.rightPanel';

/**
 * Which panel the Content body's right dock is showing (ADR-0013). The dock holds **one** panel slot
 * beside a rail of toggles: at most one panel is open, and that is a dock invariant rather than a
 * caller's rule.
 */
@Injectable()
export class RightDock {
  private readonly storage = inject(AuthScopedStorage);

  // Default closed; the last choice persists app-wide, per user, across reloads.
  private readonly _panel = signal<RightPanel | null>(this.restore(this.storage.getItem(STORAGE_KEY)));

  /** The panel currently showing, or `null` when the dock is closed. */
  readonly panel = this._panel.asReadonly();

  /** Whether any panel is showing — what the reading column reserves its room for. */
  readonly isOpen = computed(() => this._panel() !== null);

  /** Show `panel`, closing whatever was showing; toggling the open one closes the dock. */
  toggle(panel: RightPanel): void {
    this._panel.update((open) => (open === panel ? null : panel));
    this.storage.setItem(STORAGE_KEY, this._panel() ?? '');
  }

  /** A stored value is honoured only if it still names a panel — an old or corrupt one opens nothing. */
  private restore(stored: string | null): RightPanel | null {
    return stored === 'outline' ? 'outline' : null;
  }
}
