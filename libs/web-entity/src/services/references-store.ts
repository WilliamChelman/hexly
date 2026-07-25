import { Injectable, computed, inject } from '@angular/core';
import { EntityReferences } from '@hexly/domain';
import { EntitiesClient } from '@hexly/web-core';
import { EntityPanelStore } from './entity-panel-store';

/**
 * UI state for the References Panel — the open Entity's own links and the Entities that link to it
 * (CONTEXT.md → Entity Link; ADR-0046). A universal Panel of the page's Dock now (ADR-0067), moved
 * out of the content plugin: References read the core materialized link index, not prose.
 *
 * The fetch is keyed on the open Entity's `(id, seq)` (ADR-0045), not on content: References read the
 * derived edge index, which the server rebuilds only on a committed save.
 *
 * Freshness ceiling: `seq` tracks changes to *this* Entity only. A *Referenced by* row added by another
 * Entity's save, or an outbound target's rename, bumps that other Entity's `seq` and never this one's —
 * so an open panel does not see either. It refreshes on reopen, on navigation, and on this Entity's own
 * saves. The inbound half is access-filtered server-side per viewer.
 */
@Injectable()
export class ReferencesStore extends EntityPanelStore<EntityReferences> {
  private readonly entities = inject(EntitiesClient);

  /** This Entity's own links. A `target` of `null` is deleted-or-unreadable — a dangling link. */
  readonly references = computed(() => this.current()?.references ?? []);
  /**
   * The outbound links the relation surface shows: every reference by default *minus* Decor Links,
   * which the reveal restores. Filtering is client-side (the payload ships decor unfiltered, "server
   * marks, client reveals") so the reveal is instant and refetch-free.
   */
  readonly visibleReferences = computed(() =>
    this.revealDecor() ? this.references() : this.references().filter((ref) => !ref.decor),
  );
  /** There is decor to reveal — the reveal control renders only then, never as dead chrome. */
  readonly hasDecorReferences = computed(() => this.references().some((ref) => ref.decor));
  /** The Entities that link here, filtered to the ones this viewer may read. Decor is kept, marked. */
  readonly referencedBy = computed(() => this.current()?.referencedBy ?? []);
  /** False until the open Entity's list has landed, so the panel tells "loading" from "nothing". */
  readonly loaded = computed(() => this.current() !== undefined);

  constructor() {
    super();
    const target = computed(() => {
      const entity = this.session.current();
      return entity ? { id: entity.id, seq: entity.seq } : null;
    });

    this.fetchOn(target, (t) => this.entities.references(t.id));
  }
}
