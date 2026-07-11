import { Injectable, computed, inject, signal } from '@angular/core';
import { TypeRegistry } from '../../../entity-types/type-registry';
import { CORE_VIEW_CONTENT, ViewId } from '../../../entity-types/view-definition';
import { EntitySession } from './entity-session';

/**
 * Holds which {@link ViewId} the open Entity is showing — the app-shell state that
 * used to live as `HexMapStore.view`, a general "which view" concern squatting in
 * the map lib (ADR-0048, *Views* amendment). Page-scoped like the dock stores and
 * shared with the {@link EntityHeader}; reads the open Entity's types straight off
 * {@link EntitySession} (provided above the page in both the routed and Public Link
 * mounts), so the afforded Views resolve synchronously with no effect indirection.
 *
 * The raw selection is kept separate from the effective {@link activeView}: a
 * selection the current Entity doesn't afford (a stale `?view=` after navigating to
 * a note, say) falls back to the default rather than outletting a blank view.
 */
@Injectable()
export class EntityViewStore {
  private readonly session = inject(EntitySession);
  private readonly types = inject(TypeRegistry);

  /** The user's raw View selection (URL param / toggle click); may not be afforded. */
  private readonly _selected = signal<ViewId | null>(null);

  /**
   * The ordered Views the open Entity affords (primary type first) — the header
   * toggles these, and shows no toggle when there is only one.
   */
  readonly views = computed(() => this.types.viewsFor(this.session.current()?.types));

  /**
   * The effective active View: the selection when the Entity affords it, else the
   * default (the primary type's first View), else the always-present content view.
   */
  readonly activeView = computed<ViewId>(() => {
    const afforded = this.views();
    const selected = this._selected();
    if (selected && afforded.includes(selected)) return selected;
    return afforded[0] ?? CORE_VIEW_CONTENT;
  });

  /** Select a View; `null` (no `?view=` param) falls back to the default. */
  setView(view: ViewId | null): void {
    this._selected.set(view);
  }
}
