import { Inject, Injectable } from '@nestjs/common';
import { InboundLinkCount } from '@hexly/domain';
import { and, eq, ne, sql } from 'drizzle-orm';
import { unionAll } from 'drizzle-orm/sqlite-core';
import { DB, Db } from '../db/db';
import { assetIndex, entities, entityEdges, worlds } from '../db/schema';

/**
 * The blast radius of dropping a Container out of reach (ADR-0080, #414): the links pointing into it,
 * and how many **Worlds** they come from. One counter serves all three acts that break links — unmount,
 * Container delete, pack removal — because they ask the same question and differ only in whether a
 * single source World is named.
 *
 * It counts and nothing else. No act consults the answer to refuse itself: the number is stated before
 * the act and the act proceeds whatever it is, which is why this is a read with no gate of its own —
 * each caller has already gated the Container it is about to drop.
 */
@Injectable()
export class ContainerLinksService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Count the links pointing into `containerId` from the Worlds outside it. `from` narrows to one of
   * them — unmount's question, "how many links from *this* World point into that one".
   *
   * Sources are Worlds and only Worlds, which is what lets the pair be named as it is: a **Mount** is
   * the one sanctioned way to point outside your Container and only a World may declare one, so a
   * Compendium's entries point within their own pack (ADR-0080). Counting every Container instead
   * would name Containers "Worlds", which is the confusion ADR-0078 spent a rename avoiding.
   *
   * The two edge kinds resolve their target differently and both must (ADR-0080): an `entity` edge
   * names an id whose Container is the Entity's own, while an `asset` edge carries the Container its
   * URL named. Either way the target must actually exist there — an edge already dangling breaks
   * nothing further, so counting it would overstate the damage. A **Decor Link** counts, on ADR-0069's
   * split: this is a usage read, and the images going non-navigable are half of what unmounting costs.
   *
   * Driven from the **target** side, one branch per kind, because this runs in front of a user waiting
   * on a confirm: asking `entity_edges` "which of you point here?" has no sargable predicate and costs
   * the whole edge table however small the answer, while asking the Container for its Entities and its
   * Assets and following `idx_entity_edges_target` back costs the answer. The two branches cannot
   * double-count — they disagree on `targetKind`, and each target side is unique by key.
   */
  countInbound(containerId: string, from?: string): InboundLinkCount {
    // A Container's links into itself survive the act intact, so they are not blast radius — applied to
    // both branches, and load-bearing for the asset one below.
    const fromOutside = and(
      ne(entityEdges.containerId, containerId),
      from ? eq(entityEdges.containerId, from) : undefined,
    );
    // The source side is the World satellite, which is the whole of "sources are Worlds": a
    // Compendium's id simply resolves to no row here (ADR-0078).
    const sourceIsAWorld = eq(worlds.id, entityEdges.containerId);

    const entityLinks = this.db
      .select({ containerId: entityEdges.containerId })
      .from(entities)
      .innerJoin(entityEdges, and(eq(entityEdges.targetKind, 'entity'), eq(entityEdges.targetId, entities.id)))
      .innerJoin(worlds, sourceIsAWorld)
      .where(and(eq(entities.containerId, containerId), fromOutside));

    const assetLinks = this.db
      .select({ containerId: entityEdges.containerId })
      .from(assetIndex)
      .innerJoin(
        entityEdges,
        and(
          eq(entityEdges.targetKind, 'asset'),
          eq(entityEdges.targetId, assetIndex.hash),
          // The bare column, not the `coalesce` a Mount-scoped read normally goes through: a NULL there
          // resolves to the source's own Container, which `fromOutside` has already excluded, so the two
          // are the same set here — and this one is an index seek (ADR-0080).
          eq(entityEdges.targetContainerId, containerId),
        ),
      )
      .innerJoin(worlds, sourceIsAWorld)
      .where(and(eq(assetIndex.containerId, containerId), fromOutside));

    const inbound = unionAll(entityLinks, assetLinks).as('inbound');
    const row = this.db
      .select({
        links: sql<number>`count(*)`,
        worlds: sql<number>`count(distinct ${inbound.containerId})`,
      })
      .from(inbound)
      .get();
    return { links: row?.links ?? 0, worlds: row?.worlds ?? 0 };
  }
}
