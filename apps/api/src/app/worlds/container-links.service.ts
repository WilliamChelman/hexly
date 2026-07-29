import { Inject, Injectable } from '@nestjs/common';
import { InboundLinkCount } from '@hexly/domain';
import { and, eq, exists, ne, or, sql } from 'drizzle-orm';
import { DB, Db } from '../db/db';
import { assetIndex, entities, entityEdges, worlds } from '../db/schema';
import { edgeTargetContainerId } from '../entities/utils/asset-edge-target';

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
   */
  countInbound(containerId: string, from?: string): InboundLinkCount {
    const intoContainer = or(
      and(
        eq(entityEdges.targetKind, 'entity'),
        exists(
          this.db
            .select({ one: sql`1` })
            .from(entities)
            .where(and(eq(entities.id, entityEdges.targetId), eq(entities.containerId, containerId))),
        ),
      ),
      and(
        eq(entityEdges.targetKind, 'asset'),
        sql`${edgeTargetContainerId} = ${containerId}`,
        exists(
          this.db
            .select({ one: sql`1` })
            .from(assetIndex)
            .where(and(eq(assetIndex.containerId, containerId), eq(assetIndex.hash, entityEdges.targetId))),
        ),
      ),
    );
    const row = this.db
      .select({
        links: sql<number>`count(*)`,
        worlds: sql<number>`count(distinct ${entityEdges.containerId})`,
      })
      .from(entityEdges)
      // The source side is the World satellite, which is the whole of "sources are Worlds": a
      // Compendium's id simply resolves to no row here (ADR-0078).
      .innerJoin(worlds, eq(worlds.id, entityEdges.containerId))
      .where(
        and(
          // A Container's links into itself survive the act intact, so they are not blast radius.
          ne(entityEdges.containerId, containerId),
          from ? eq(entityEdges.containerId, from) : undefined,
          intoContainer,
        ),
      )
      .get();
    return { links: row?.links ?? 0, worlds: row?.worlds ?? 0 };
  }
}
