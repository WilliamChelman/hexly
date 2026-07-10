import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { LinkedEntity, WorldGraph, WorldGraphEdge } from '@hexly/domain';
import { entityAccess, EntityAccess } from '../acl/entity-access';
import { worldAccess } from '../acl/world-access';
import { DB, Db } from '../db/db';
import { entities, entityEdges } from '../db/schema';
import { linkedEntity } from '../entities/utils/linked-entity';

/**
 * The World Graph read (ADR-0046, #181): a World's readable Entities as nodes, the
 * `entity → entity` rows of the derived edge index between them as edges.
 *
 * Its access rule is the strictest of the three edge surfaces. *References* lets an unreadable
 * target dangle and *Referenced by* filters the source alone; here **both** endpoints are filtered,
 * because a graph names the things at either end of a line. An edge the viewer cannot fully see is
 * dropped, never rendered as a ghost node.
 */
@Injectable()
export class WorldGraphService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** The whole readable World. `null` when the World is unreachable — the 404 gate. */
  graph(userId: string, worldId: string): WorldGraph | null {
    if (!worldAccess(this.db, userId).decideMeta(worldId)?.reachable) return null;
    const access = entityAccess(this.db, userId);
    const nodes = this.nodes(access, worldId);
    return { nodes, edges: this.edges(worldId, new Set(nodes.map((n) => n.id))) };
  }

  /**
   * Every Entity of the World the viewer can read — the ordinary accessible-entities filter, not
   * the edge table, so a link-less orphan is a node like any other. Assets are never nodes.
   *
   * An Entity {@link linkedEntity} cannot resolve — one whose stored type is outside the enum — is
   * dropped rather than thrown on, because a node with no drawable type is a node this canvas has
   * no colour for. {@link edges} then sieves its edges away for free. One such row must not 500 a
   * whole World's graph while every other surface renders it.
   */
  private nodes(access: EntityAccess, worldId: string): LinkedEntity[] {
    return this.db
      .select({ id: entities.id, name: entities.name, type: entities.type })
      .from(entities)
      .where(and(eq(entities.worldId, worldId), access.filter))
      .orderBy(asc(entities.name), asc(entities.id))
      .all()
      .flatMap((row) => linkedEntity(row.id, row.name, row.type) ?? []);
  }

  /**
   * The World's `entity → entity` edges, kept only where **both** endpoints are nodes. Sieving
   * against the node set rather than restating the read predicate in SQL is what makes the graph's
   * central invariant true by construction — `edges ⊆ nodes × nodes` — and it cannot drift from
   * {@link nodes} the way a second copy of the filter could. It also settles the other three drops
   * for free, because none of those targets is a node either: a target the viewer cannot read, a
   * deleted one (the row survives its target, ADR-0046), and one in another World.
   *
   * The indexed `WHERE worldId = ? AND targetKind = 'entity'` (`idx_entity_edges_world`) is the
   * reason `worldId` is denormalized onto an edge at all. `targetKind` keeps Assets out: they are
   * harvested as edges but are never nodes, so they could never survive the sieve anyway — naming
   * them in the WHERE lets the index do it instead of the loop.
   */
  private edges(worldId: string, nodeIds: ReadonlySet<string>): WorldGraphEdge[] {
    return this.db
      .select({
        source: entityEdges.sourceEntityId,
        target: entityEdges.targetId,
        descriptor: entityEdges.descriptor,
      })
      .from(entityEdges)
      .where(and(eq(entityEdges.worldId, worldId), eq(entityEdges.targetKind, 'entity')))
      .orderBy(asc(entityEdges.sourceEntityId), asc(entityEdges.targetId), asc(entityEdges.descriptor))
      .all()
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
  }
}
