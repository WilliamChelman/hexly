import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthScopedStorage } from '@hexly/web-core';
import { PanelDefinition, PanelId } from '../models/panel-definition';

/** Per-user preference key (auth-scoped), so one user's Dock choice never leaks to the next. */
export const DOCK_STORAGE_KEY = 'entity.dockPanel';

/**
 * The Entity page's one **Dock** (ADR-0067). Page-scoped: provided above the View outlet so both the
 * Dock chrome *and* the running View share the instance — a View reaches it to {@link claim} the open
 * slot. It holds **at most one** open Panel, and which Panel is open is a Dock invariant, not a
 * caller's rule.
 *
 * Two channels feed the slot, in precedence order:
 * - a transient **claim** a View makes programmatically ({@link claim}), e.g. a selection opening an
 *   Inspector — never persisted, so it cannot overwrite the user's choice;
 * - the user's **remembered** choice ({@link toggle}/{@link open}/{@link close}) — persisted per user,
 *   cross-View, across sessions.
 *
 * Both are resolved against the {@link available} Panels the current View offers: a remembered or
 * claimed Panel the View does not offer **closes** the Dock rather than substituting another
 * ({@link openPanel} returns `null`), and reopens unchanged when a View that offers it comes back.
 */
@Injectable()
export class EntityDock {
  private readonly storage = inject(AuthScopedStorage);

  /** The Panels the current View offers, set by the Dock chrome as the active View changes. */
  private readonly _available = signal<readonly PanelDefinition[]>([]);
  readonly available = this._available.asReadonly();

  /** The user's persisted choice — cross-View, per user, restored on construction. */
  private readonly _remembered = signal<PanelId | null>(this.restore());

  /** A View's transient programmatic claim on the slot; never persisted. */
  private readonly _claim = signal<PanelId | null>(null);

  /** What the Dock is asked to show — a live claim wins, else the remembered choice. */
  private readonly requested = computed(() => this._claim() ?? this._remembered());

  /**
   * The Panel actually open: the requested one *if the current View offers it*, else `null`. The
   * close-don't-substitute rule and the availability filter both live here, so no caller can drive the
   * Dock into showing a Panel the strip could not.
   */
  readonly openPanel = computed<PanelDefinition | null>(() => {
    const id = this.requested();
    return this._available().find((p) => p.id === id) ?? null;
  });

  /** Whether any Panel is open — what the layout reserves its column for. */
  readonly isOpen = computed(() => this.openPanel() !== null);

  /** Set the Panels the current View offers (universal ∪ the View's, already write-gated by the chrome). */
  setAvailable(panels: readonly PanelDefinition[]): void {
    this._available.set(panels);
  }

  /** Show `id`, closing whatever was showing; toggling the open one closes the Dock. A user action clears any claim. */
  toggle(id: PanelId): void {
    this._claim.set(null);
    this._remembered.update((open) => (open === id ? null : id));
    this.persist();
  }

  /** Programmatically claim the slot for `id` without touching the user's remembered choice (ADR-0067). */
  claim(id: PanelId): void {
    this._claim.set(id);
  }

  /** Drop a programmatic claim, falling back to the user's remembered choice. */
  releaseClaim(): void {
    this._claim.set(null);
  }

  private persist(): void {
    this.storage.setItem(DOCK_STORAGE_KEY, this._remembered() ?? '');
  }

  /** A stored id is honoured only once {@link openPanel} finds it in the available set, so a stale or
   * corrupt value simply opens nothing. */
  private restore(): PanelId | null {
    const stored = this.storage.getItem(DOCK_STORAGE_KEY);
    return stored ? (stored as PanelId) : null;
  }
}
