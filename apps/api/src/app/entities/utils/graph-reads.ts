import { and, asc, eq } from 'drizzle-orm';
import { LinkedEntity, WorldGraph, WorldGraphEdge } from '@hexly/domain';
import { EntityAccess } from '../../acl/entity-access';
import { Db } from '../../db/db';
import { assetIndex, entities, entityEdges } from '../../db/schema';
import { linkedEntity } from './linked-entity';

/**
 * A World's nodes and edges, as every graph projection of it reads them (ADR-0046) — the whole-World
 * {@link WorldGraphService} returns this, the Entity-centred Local Graph (ADR-0072) narrows it to one
 * neighbourhood. A plain function over a `Db`, like {@link linkedEntity} beside it, so one definition of
 * "what a node is" and "what an edge is" serves both; `worlds` reaches into `entities/utils` for it
 * rather than either service owning a second copy.
 */
export function worldGraphRead(db: Db, access: EntityAccess, worldId: string): WorldGraph {
  const nodes = graphNodes(db, access, worldId);
  return { nodes, edges: graphEdges(db, worldId, nodes) };
}

/**
 * Every Entity of the World the viewer can read — filtered off the entities table, not the edge
 * table, so a link-less orphan is a node like any other. Assets are Entities (ADR-0065), so they
 * fall out of this same query as ordinary nodes; a client's decor + show-orphans filters, not this
 * read, keep unlinked ones (bulk-minted art, decor-only Assets) from flooding the picture.
 *
 * An Entity {@link linkedEntity} cannot resolve — one whose stored types are malformed — is
 * dropped rather than thrown on, so one bad row cannot 500 a whole World's graph.
 */
function graphNodes(db: Db, access: EntityAccess, worldId: string): LinkedEntity[] {
  return db
    .select({ id: entities.id, name: entities.name, types: entities.types })
    .from(entities)
    .where(and(eq(entities.containerId, worldId), access.filter))
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
 * join the `(containerId, hash)` dedup index to reach the Asset's Entity here, at read time, making an
 * Asset's usage its inbound links like any other node. The hash join is Container-scoped: identical
 * bytes in two Containers share a hash but not an Entity.
 *
 * `containerId` is denormalized onto an edge to serve the indexed `WHERE containerId = ? AND
 * targetKind = ?` (`idx_entity_edges_container`).
 */
function graphEdges(db: Db, worldId: string, nodes: readonly LinkedEntity[]): WorldGraphEdge[] {
  const nodeIds = new Set(nodes.map((n) => n.id));

  const entityEdgesRows = db
    .select({
      source: entityEdges.sourceEntityId,
      target: entityEdges.targetId,
      descriptor: entityEdges.descriptor,
      decor: entityEdges.decor,
    })
    .from(entityEdges)
    .where(and(eq(entityEdges.containerId, worldId), eq(entityEdges.targetKind, 'entity')))
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
    .innerJoin(
      assetIndex,
      and(eq(assetIndex.hash, entityEdges.targetId), eq(assetIndex.containerId, entityEdges.containerId)),
    )
    .where(and(eq(entityEdges.containerId, worldId), eq(entityEdges.targetKind, 'asset')))
    .orderBy(asc(entityEdges.sourceEntityId), asc(assetIndex.entityId), asc(entityEdges.descriptor))
    .all();

  return [...entityEdgesRows, ...assetEdgesRows].filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
}
