import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { LinkedEntity, WorldGraph, WorldGraphEdge } from '@hexly/domain';
import { entityAccess, EntityAccess } from '../acl/entity-access';
import { worldAccess } from '../acl/world-access';
import { DB, Db } from '../db/db';
import { assetIndex, entities, entityEdges } from '../db/schema';
import { linkedEntity } from '../entities/utils/linked-entity';

/**
 * The World Graph read (ADR-0046): a World's readable Entities as nodes, the derived edge index
 * between them as edges. Assets are ordinary nodes (ADR-0065): their usage is their inbound links,
 * so the content-addressed asset edges are resolved to the Asset's Entity here, at read time.
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
   * table, so a link-less orphan is a node like any other. Assets are Entities (ADR-0065), so they
   * fall out of this same query as ordinary nodes; the client's show-orphans toggle, not this read,
   * keeps unlinked ones (bulk-minted art) from flooding the picture.
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
   * The World's edges, kept only where **both** endpoints are nodes: `edges ⊆ nodes × nodes`.
   * Sieving against the node set from {@link nodes} also drops, for free, targets the viewer cannot
   * read, deleted ones (an edge row survives its target, ADR-0046), and ones in another World.
   *
   * Two kinds feed one edge list. `entity` edges name their target Entity directly. `asset` edges
   * (ADR-0065) name a content-addressed **hash**, not an id — the harvest never resolved it — so they
   * join the `(worldId, hash)` dedup index to reach the Asset's Entity here, at read time, making an
   * Asset's usage its inbound links like any other node. The hash join is World-scoped: identical
   * bytes in two Worlds share a hash but not an Entity.
   *
   * `worldId` is denormalized onto an edge to serve the indexed `WHERE worldId = ? AND targetKind = ?`
   * (`idx_entity_edges_world`).
   */
  private edges(worldId: string, nodeIds: ReadonlySet<string>): WorldGraphEdge[] {
    const entityEdgesRows = this.db
      .select({
        source: entityEdges.sourceEntityId,
        target: entityEdges.targetId,
        descriptor: entityEdges.descriptor,
      })
      .from(entityEdges)
      .where(and(eq(entityEdges.worldId, worldId), eq(entityEdges.targetKind, 'entity')))
      .orderBy(asc(entityEdges.sourceEntityId), asc(entityEdges.targetId), asc(entityEdges.descriptor))
      .all();

    const assetEdgesRows = this.db
      .select({
        source: entityEdges.sourceEntityId,
        target: assetIndex.entityId,
        descriptor: entityEdges.descriptor,
      })
      .from(entityEdges)
      .innerJoin(
        assetIndex,
        and(eq(assetIndex.hash, entityEdges.targetId), eq(assetIndex.worldId, entityEdges.worldId)),
      )
      .where(and(eq(entityEdges.worldId, worldId), eq(entityEdges.targetKind, 'asset')))
      .orderBy(asc(entityEdges.sourceEntityId), asc(assetIndex.entityId), asc(entityEdges.descriptor))
      .all();

    return [...entityEdgesRows, ...assetEdgesRows].filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
  }
}
