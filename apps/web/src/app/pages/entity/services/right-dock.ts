import { InjectionToken, Injectable, computed, inject, signal } from '@angular/core';
import { AuthScopedStorage } from '@hexly/web-core';

/** The panels that share the Content body's right dock. Exactly one shows, or none. */
export type RightPanel = 'outline' | 'references';

/** Per-user preference key (auth-scoped), so one user's choice never leaks to the next. */
const STORAGE_KEY = 'entity.rightPanel';

/**
 * The panels the mounting context actually offers, narrowing the dock's rail. Availability is a
 * property of the *context*, not of the viewer's Rights: a reader with no `edit` verb still gets
 * every panel, but a Public Link page cannot offer References — `GET /entities/:id/references`
 * answers a `CurrentUser`, which an anonymous reader has none of. Defaults to every panel.
 */
export const RIGHT_DOCK_PANELS = new InjectionToken<readonly RightPanel[]>('RIGHT_DOCK_PANELS', {
  factory: (): readonly RightPanel[] => ['outline', 'references'],
});

/**
 * Which panel the Content body's right dock is showing (ADR-0013). The dock holds **one** panel
 * slot beside a rail of toggles: at most one panel is open, and that is a dock invariant rather
 * than a caller's rule.
 */
@Injectable()
export class RightDock {
  private readonly storage = inject(AuthScopedStorage);
  private readonly panels = inject(RIGHT_DOCK_PANELS);

  // Default closed; the last choice persists app-wide, per user, across reloads.
  private readonly _panel = signal(this.restore(this.storage.getItem(STORAGE_KEY)));

  /** The panel currently showing, or `null` when the dock is closed. */
  readonly panel = this._panel.asReadonly();

  /** Whether any panel is showing — what the reading column reserves its room for. */
  readonly isOpen = computed(() => this._panel() !== null);

  /** Whether this context offers `panel` at all — the rail renders a toggle only for the ones it does. */
  offers(panel: RightPanel): boolean {
    return this.panels.includes(panel);
  }

  /** Show `panel`, closing whatever was showing; toggling the open one closes the dock. */
  toggle(panel: RightPanel): void {
    // A panel this context does not offer has no toggle to press — but guard the seam anyway, so
    // the dock cannot be driven into a state its own rail could never produce.
    if (!this.offers(panel)) return;
    this._panel.update((open) => (open === panel ? null : panel));
    this.storage.setItem(STORAGE_KEY, this._panel() ?? '');
  }

  /**
   * A stored value is honoured only if it still names a panel this context offers — an old or
   * corrupt one opens nothing, and so does a Public Link viewer's carried-over `references`
   * ({@link AuthScopedStorage} keeps the per-browser preference while the session is anonymous).
   */
  private restore(stored: string | null): RightPanel | null {
    const panel = stored === 'outline' || stored === 'references' ? stored : null;
    return panel && this.offers(panel) ? panel : null;
  }
}
