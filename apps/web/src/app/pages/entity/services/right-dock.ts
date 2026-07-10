import { InjectionToken, Injectable, computed, inject, signal } from '@angular/core';
import { AuthScopedStorage } from '@hexly/web-core';

/** The panels that share the Content body's right dock. Exactly one shows, or none. */
export type RightPanel = 'outline' | 'references';

/** Per-user preference key (auth-scoped), so one user's choice never leaks to the next. */
const STORAGE_KEY = 'entity.rightPanel';

/**
 * The panels the mounting context actually offers, narrowing the dock's rail.
 *
 * A Public Link page mounts the same `EntityPage` for an anonymous reader, and References is
 * not a panel it can serve: `GET /entities/:id/references` answers a `CurrentUser`, and a Public
 * Link grants only its own Entity's scope — the same reason in-content Entity Links there resolve
 * to a frozen label rather than a navigable one. So availability is a property of the *context*,
 * not of the viewer's Rights: an authenticated reader with no `edit` verb still gets References,
 * which is why the toggles are ungated by `writable()`.
 *
 * Defaults to every panel, so the authenticated route says nothing and the exception states itself.
 */
export const RIGHT_DOCK_PANELS = new InjectionToken<readonly RightPanel[]>('RIGHT_DOCK_PANELS', {
  factory: (): readonly RightPanel[] => ['outline', 'references'],
});

/**
 * Which panel the Content body's right dock is showing (ADR-0013) — the note-view peer of
 * `HexMapStore.rightPanel`, and modelled the same way on purpose.
 *
 * The dock holds **one** panel slot beside a rail of toggles, so "at most one panel is open" is a
 * dock invariant, not a caller's rule. One discriminant, not a boolean per panel, makes "both open
 * at once" — one panel hidden behind another while both toggles read active — unrepresentable.
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
   * (the preference is per-browser, and {@link AuthScopedStorage} deliberately keeps it while
   * the session is anonymous).
   */
  private restore(stored: string | null): RightPanel | null {
    const panel = stored === 'outline' || stored === 'references' ? stored : null;
    return panel && this.offers(panel) ? panel : null;
  }
}
