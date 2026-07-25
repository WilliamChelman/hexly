import { and, asc, eq } from 'drizzle-orm';
import { LinkedEntity, WorldGraphEdge } from '@hexly/domain';
import { EntityAccess } from '../../acl/entity-access';
import { Db } from '../../db/db';
import { assetIndex, entities, entityEdges } from '../../db/schema';
import { linkedEntity } from './linked-entity';

/**
 * The two reads every graph projection of a World is built from (ADR-0046) — the whole-World
 * {@link WorldGraphService} and the Entity-centred Local Graph (ADR-0072) alike. Plain functions over a
 * `Db`, like {@link linkedEntity} beside them, so both callers share one definition of "what a node is"
 * and "what an edge is" without either feature module depending on the other's.
 */

/**
 * Every Entity of the World the viewer can read — filtered off the entities table, not the edge
 * table, so a link-less orphan is a node like any other. Assets are Entities (ADR-0065), so they
 * fall out of this same query as ordinary nodes; a client's decor + show-orphans filters, not this
 * read, keep unlinked ones (bulk-minted art, decor-only Assets) from flooding the picture.
 *
 * An Entity {@link linkedEntity} cannot resolve — one whose stored types are malformed — is
 * dropped rather than thrown on, so one bad row cannot 500 a whole World's graph.
 */
export function graphNodes(db: Db, access: EntityAccess, worldId: string): LinkedEntity[] {
  return db
    .select({ id: entities.id, name: entities.name, types: entities.types })
    .from(entities)
    .where(and(eq(entities.worldId, worldId), access.filter))
    .orderBy(asc(entities.name), asc(entities.id))
    .all()
    .flatMap((row) => linkedEntity(row.id, row.name, row.types) ?? []);
}

/**
 * The World's edges, kept only where **both** endpoints are nodes: `edges ⊆ nodes × nodes`.
 * Sieving against the node set from {@link graphNodes} also drops, for free, targets the viewer cannot
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
export function graphEdges(db: Db, worldId: string, nodeIds: ReadonlySet<string>): WorldGraphEdge[] {
  const entityEdgesRows = db
    .select({
      source: entityEdges.sourceEntityId,
      target: entityEdges.targetId,
      descriptor: entityEdges.descriptor,
      decor: entityEdges.decor,
    })
    .from(entityEdges)
    .where(and(eq(entityEdges.worldId, worldId), eq(entityEdges.targetKind, 'entity')))
    .orderBy(asc(entityEdges.sourceEntityId), asc(entityEdges.targetId), asc(entityEdges.descriptor))
    .all();

  const assetEdgesRows = db
    .select({
      source: entityEdges.sourceEntityId,
      target: assetIndex.entityId,
      descriptor: entityEdges.descriptor,
      decor: entityEdges.decor,
    })
    .from(entityEdges)
    .innerJoin(assetIndex, and(eq(assetIndex.hash, entityEdges.targetId), eq(assetIndex.worldId, entityEdges.worldId)))
    .where(and(eq(entityEdges.worldId, worldId), eq(entityEdges.targetKind, 'asset')))
    .orderBy(asc(entityEdges.sourceEntityId), asc(assetIndex.entityId), asc(entityEdges.descriptor))
    .all();

  return [...entityEdgesRows, ...assetEdgesRows].filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
}
