import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { LinkedEntity, WorldGraph, WorldGraphEdge } from '@hexly/domain';
import { entityAccess, EntityAccess } from '../acl/entity-access';
import { worldAccess } from '../acl/world-access';
import { DB, Db } from '../db/db';
import { entities, entityEdges } from '../db/schema';
import { linkedEntity } from '../entities/utils/linked-entity';

/**
 * The World Graph read (ADR-0046): a World's readable Entities as nodes, the `entity → entity` rows
 * of the derived edge index between them as edges.
 *
 * Unlike the other edge surfaces, **both** endpoints are access-filtered here: an edge the viewer
 * cannot fully see is dropped, not rendered as a dangling target.
 */
@Injectable()
export class WorldGraphService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** The whole readable World. `null` when the World is unreachable — the 404 gate. */
  graph(userId: string, worldId: string): WorldGraph | null {
    if (!worldAccess(this.db, userId).decideMeta(worldId)?.reachable) return null;
    const access = entityAccess(this.db, userId);
    const nodes = this.nodes(access, worldId);
    return {
      nodes,
      edges: this.edges(worldId, new Set(nodes.map((n) => n.id))),
    };
  }

  /**
   * Every Entity of the World the viewer can read — filtered off the entities table, not the edge
   * table, so a link-less orphan is a node like any other. Assets are never nodes.
   *
   * An Entity {@link linkedEntity} cannot resolve — one whose stored types are malformed — is
   * dropped rather than thrown on, so one bad row cannot 500 a whole World's graph.
   */
  private nodes(access: EntityAccess, worldId: string): LinkedEntity[] {
    return this.db
      .select({ id: entities.id, name: entities.name, types: entities.types })
      .from(entities)
      .where(and(eq(entities.worldId, worldId), access.filter))
      .orderBy(asc(entities.name), asc(entities.id))
      .all()
      .flatMap((row) => linkedEntity(row.id, row.name, row.types) ?? []);
  }

  /**
   * The World's `entity → entity` edges, kept only where **both** endpoints are nodes:
   * `edges ⊆ nodes × nodes`. Sieving against the node set from {@link nodes} also drops, for free,
   * targets the viewer cannot read, deleted ones (an edge row survives its target, ADR-0046), and
   * ones in another World.
   *
   * `worldId` is denormalized onto an edge to serve the indexed
   * `WHERE worldId = ? AND targetKind = 'entity'` (`idx_entity_edges_world`). Assets are harvested
   * as edges but are never nodes, so `targetKind` lets the index exclude them rather than the loop.
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
