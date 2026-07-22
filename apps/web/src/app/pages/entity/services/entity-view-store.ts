import { Injectable, computed, inject, signal } from '@angular/core';
import { TypeRegistry } from '../../../entity-types/type-registry';
import { CORE_VIEW_DETAILS, ViewInstance, parseViewInstanceKey, viewInstanceKey } from '@hexly/web-entity';
import { EntitySession } from './entity-session';

/**
 * Holds which View the open Entity is showing (ADR-0048, *Views* amendment). Page-scoped and shared
 * with the {@link EntityHeader}; reads the open Entity's types off {@link EntitySession}, provided
 * above the page in both the routed and Public Link mounts.
 *
 * A View is a {@link ViewInstance} — an id, plus the **Field of a Structured Data Type** it renders when it is a
 * Field's View rather than a Type's (ADR-0050). The selection is carried as that instance's
 * {@link viewInstanceKey}.
 *
 * The raw selection is kept separate from the effective {@link activeView}: a selection the current
 * Entity doesn't afford (a stale `?view=` after navigating to a note, say) falls back to the default
 * rather than outletting a blank view.
 */
@Injectable()
export class EntityViewStore {
  private readonly session = inject(EntitySession);
  private readonly types = inject(TypeRegistry);

  /** The user's raw View selection, as its key (URL param / toggle click); may not be afforded. */
  private readonly _selected = signal<string | null>(null);

  /**
   * The ordered Views the open Entity affords (primary type first) — the header
   * toggles these, and shows no toggle when there is only one.
   */
  readonly views = computed(() => this.types.viewsFor(this.session.types(), this.session.fields()));

  /**
   * The effective active View: the selection when the Entity affords it, else the
   * default (the primary type's first View), else the always-present Details View (ADR-0051, ADR-0067).
   */
  readonly activeView = computed<ViewInstance>(() => {
    const afforded = this.views();
    const selected = this._selected();
    const found = afforded.find((view) => viewInstanceKey(view) === selected);
    return found ?? afforded[0] ?? { viewId: CORE_VIEW_DETAILS };
  });

  /**
   * The active View's key — what the URL carries and the toggle's testid reads.
   *
   * A string, so it settles where {@link activeView} mints a fresh object each time the afforded set is
   * rebuilt. The page outlets on this identity: keyed on the object, an unrelated type added to the
   * Entity would tear the live View down and rebuild it, losing a map's undo stack.
   */
  readonly activeKey = computed(() => viewInstanceKey(this.activeView()));

  /** The **Field of a Structured Data Type** the active View renders, or `undefined` for a Type's own View. */
  readonly activeFieldKey = computed(() => parseViewInstanceKey(this.activeKey())?.fieldKey);

  /** Select a View by its key; `null` (no `?view=` param) falls back to the default. */
  setView(view: string | null): void {
    this._selected.set(view);
  }
}
