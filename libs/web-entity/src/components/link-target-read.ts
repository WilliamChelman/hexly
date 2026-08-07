import { Signal, WritableSignal, computed, effect, inject, signal, untracked } from '@angular/core';
import { EntityFacets } from '@hexly/domain';
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
 *
 * `includeMounts` is how a surface the ADR does not widen declines it — the widening is enumerated
 * there (the `@` picker, the Entity Link Field picker, the Board Embed picker, the asset and Board image
 * pickers), and a pick stored as the World's own is not among them. It narrows to the World's own
 * Container rather than asking a different read, since the scope and the narrowing AND server-side: the
 * link-target read's own Asset gate and ranking are unchanged, only its reach.
 */
export function linkTargetRead(
  worldId: () => string | undefined,
  narrowing: () => LinkTargetNarrowing,
  includeMounts: () => boolean = () => true,
): LinkTargetRead {
  const container = signal<string | undefined>(undefined);
  // A narrowing the World outlives would silently answer the next search from a Container the user
  // cannot see chosen: a new World is a new set of Containers, so the selection goes with it.
  effect(() => {
    worldId();
    untracked(() => container.set(undefined));
  });
  const params = computed<EntityFacetParams>(() => {
    const world = worldId();
    const picked = includeMounts() ? container() : world;
    return { ...narrowing(), worldId: world, container: picked ? [picked] : undefined, read: 'link-target' };
  });
  return { container, params };
}

/**
 * The **Facet read** behind a picker, counted off the very read its options come from — its own
 * Container selection dropped, as every drill-down facet's is, so the chip you are standing on keeps
 * its siblings to move to. A failed count leaves no facets rather than stranding a stale one. `when` is
 * the picker's own open/closed gate: a closed panel counts nothing.
 *
 * One request, read twice: the **Container** facet its chips render (ADR-0080), and the values and
 * counts its box offers a **Facet Token** (ADR-0082) — which is what makes typeahead there cost nothing
 * new. `null` until the first response lands, which is a box with no value stage yet, not an empty one.
 */
export function linkTargetFacets(
  params: Signal<EntityFacetParams>,
  when: () => boolean = () => true,
): Signal<EntityFacets | null> {
  const entities = inject(EntitiesClient);
  const facets = signal<EntityFacets | null>(null);
  effect((onCleanup) => {
    if (!when()) {
      facets.set(null);
      return;
    }
    const sub = entities.facets({ ...params(), container: undefined }).subscribe({
      next: (counts) => facets.set(counts),
      error: () => facets.set(null),
    });
    onCleanup(() => sub.unsubscribe());
  });
  return facets.asReadonly();
}
