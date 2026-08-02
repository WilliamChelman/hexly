import { Signal, WritableSignal, computed, effect, inject, signal, untracked } from '@angular/core';
import { FacetCount } from '@hexly/domain';
import { EntitiesClient, EntityFacetParams } from '@hexly/web-core';

/**
 * What one picker pins on top of the shared scope — its search text and its type/field constraints.
 * The scope itself is not the picker's to name, which is why the three keys it may not set are gone.
 */
export type LinkTargetNarrowing = Omit<EntityFacetParams, 'worldId' | 'container' | 'read'>;

/** A picker's **link-target read**: the params it queries through, and the Container it is narrowed to. */
export interface LinkTargetRead {
  /** The Container narrowed to, if any — one pack, or one Shelf; `undefined` is "All" (ADR-0080). */
  readonly container: WritableSignal<string | undefined>;
  /** The one read behind both a picker's options and the chips annotating them, so the two cannot disagree. */
  readonly params: Signal<EntityFacetParams>;
}

/**
 * The **link-target read** every picker asks — *what may this point at?* — declared once rather than
 * once per picker (CONTEXT.md → Link-target read, ADR-0079). Naming the World is what widens it: the
 * server answers with that World's Entities *and* the ones in the Containers it **Mounts**, the World's
 * own ranked first, narrowable to one of them (ADR-0080). Resolved server-side, so no picker can widen
 * its own scope.
 */
export function linkTargetRead(
  worldId: () => string | undefined,
  narrowing: () => LinkTargetNarrowing,
): LinkTargetRead {
  const container = signal<string | undefined>(undefined);
  // A narrowing the World outlives would silently answer the next search from a Container the user
  // cannot see chosen: a new World is a new set of Containers, so the selection goes with it.
  effect(() => {
    worldId();
    untracked(() => container.set(undefined));
  });
  const params = computed<EntityFacetParams>(() => {
    const picked = container();
    return { ...narrowing(), worldId: worldId(), container: picked ? [picked] : undefined, read: 'link-target' };
  });
  return { container, params };
}

/**
 * The **Container** facet's live values behind a picker's chips, counted off the very read the options
 * come from — its own selection dropped, as every drill-down facet's is, so the chip you are
 * standing on keeps its siblings to move to. A failed count empties the chips rather than stranding a
 * stale one. `when` is the picker's own open/closed gate: a closed panel counts nothing.
 */
export function containerFacet(
  params: Signal<EntityFacetParams>,
  when: () => boolean = () => true,
): Signal<readonly FacetCount[]> {
  const entities = inject(EntitiesClient);
  const containers = signal<readonly FacetCount[]>([]);
  effect((onCleanup) => {
    if (!when()) {
      containers.set([]);
      return;
    }
    const sub = entities.facets({ ...params(), container: undefined }).subscribe({
      next: (facets) => containers.set(facets.container ?? []),
      error: () => containers.set([]),
    });
    onCleanup(() => sub.unsubscribe());
  });
  return containers.asReadonly();
}
