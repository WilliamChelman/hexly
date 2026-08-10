import { and, asc, eq, ne, sql } from 'drizzle-orm';
import { WorldGraph, WorldGraphEdge, WorldGraphNode } from '@hexly/domain';
import { EntityAccess } from '../../acl/entity-access';
import { Db } from '../../db/db';
import { assetIndex, entities, entityEdges } from '../../db/schema';
import { edgeTargetContainerId } from './asset-edge-target';
import { linkedEntity } from './linked-entity';

/**
 * A World's nodes and edges, as every graph projection of it reads them (ADR-0046) — the whole-World
 * {@link WorldGraphService} returns this, the Entity-centred Local Graph (ADR-0072) narrows it to one
 * neighbourhood. A plain function over a `Db`, like {@link linkedEntity} beside it, so one definition of
 * "what a node is" and "what an edge is" serves both; `worlds` reaches into `entities/utils` for it
 * rather than either service owning a second copy.
 */
export function worldGraphRead(db: Db, access: EntityAccess, worldId: string): WorldGraph {
  const own = graphNodes(db, access, worldId);
  const entityEdgeRows = entityGraphEdges(db, worldId);
  const assetEdgeRows = assetGraphEdges(db, access, worldId);
  const away = [...linkedTargets(db, access, worldId), ...assetEdgeRows.map(assetTarget)];
  const nodes = [...own, ...foreignNodes(worldId, away)];
  // `edges ⊆ nodes × nodes`. Sieving against the node set drops, for free, targets the viewer cannot read
  // and deleted ones (an edge row survives its target, ADR-0046).
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = [...entityEdgeRows, ...assetEdgeRows.map(toEdge)];
  return { nodes, edges: edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)) };
}

/**
 * The ids the Local Graph's walk must not cross — the **Foreign nodes** (ADR-0080). Read back off the
 * payload rather than passed beside it, so the mark and the rule cannot drift apart.
 */
export function foreignNodeIds(graph: WorldGraph): ReadonlySet<string> {
  return new Set(graph.nodes.flatMap((n) => (n.foreignContainerId ? [n.id] : [])));
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
function graphNodes(db: Db, access: EntityAccess, worldId: string): WorldGraphNode[] {
  return db
    .select({ id: entities.id, name: entities.name, types: entities.types })
    .from(entities)
    .where(and(eq(entities.containerId, worldId), access.listFilter))
    .orderBy(asc(entities.name), asc(entities.id))
    .all()
    .flatMap((row) => linkedEntity(row.id, row.name, row.types) ?? []);
}

/** A link target resolved to the row a node would be drawn from — the Container included, which is the whole question. */
interface TargetRow {
  readonly id: string;
  readonly name: string;
  readonly types: unknown;
  readonly containerId: string;
}

/**
 * The **Foreign nodes** of this graph: every link target living in another Container, deduped and appended
 * after the World's own — drawn rather than dropped, since a shelf's image already renders on the page
 * (ADR-0080).
 *
 * `foreignContainerId` is the mark, what a click navigates by, and what makes the node terminal to a walk.
 */
function foreignNodes(worldId: string, targets: readonly TargetRow[]): WorldGraphNode[] {
  const seen = new Set<string>();
  const foreign: WorldGraphNode[] = [];
  for (const row of targets) {
    if (row.containerId === worldId || seen.has(row.id)) continue;
    seen.add(row.id);
    const node = linkedEntity(row.id, row.name, row.types);
    if (node) foreign.push({ ...node, foreignContainerId: row.containerId });
  }
  return foreign.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/**
 * The World's `entity` edges, which name their target Entity directly.
 *
 * `containerId` is denormalized onto an edge to serve the indexed `WHERE containerId = ? AND
 * targetKind = ?` (`idx_entity_edges_container`).
 */
function entityGraphEdges(db: Db, worldId: string): WorldGraphEdge[] {
  return db
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
}

/**
 * The Entities this World's `entity` edges point at **outside** it — one row per Foreign target, resolved
 * under the read filter exactly as the World's own nodes are, so one the viewer cannot read is no node and
 * so (by the sieve) no edge.
 *
 * A second query rather than a join onto {@link entityGraphEdges}: the edge read is served whole by
 * `idx_entity_edges_container`, and a World's own links — nearly all of them — need no target row at all.
 */
function linkedTargets(db: Db, access: EntityAccess, worldId: string): TargetRow[] {
  return db
    .selectDistinct({
      id: entities.id,
      name: entities.name,
      types: entities.types,
      containerId: entities.containerId,
    })
    .from(entityEdges)
    .innerJoin(
      entities,
      and(eq(entities.id, entityEdges.targetId), ne(entities.containerId, worldId), access.listFilter),
    )
    .where(and(eq(entityEdges.containerId, worldId), eq(entityEdges.targetKind, 'entity')))
    .all();
}

/** An `asset` edge with its resolved Asset carried alongside, so a foreign one can become a node. */
interface AssetEdgeRow extends WorldGraphEdge {
  readonly name: string;
  readonly types: unknown;
  readonly targetContainerId: string;
}

/** The Asset's own columns, as {@link foreignNodes} reads any link target. */
function assetTarget(row: AssetEdgeRow): TargetRow {
  return { id: row.target, name: row.name, types: row.types, containerId: row.targetContainerId };
}

/** The edge alone — the Asset's columns ride the row for the node set, never the payload. */
function toEdge({ source, target, descriptor, decor }: AssetEdgeRow): WorldGraphEdge {
  return { source, target, descriptor, decor };
}

/**
 * The World's `asset` edges (ADR-0065), which name a content-addressed **hash**, not an id — the harvest
 * never resolved it — so they join the `(containerId, hash)` dedup index to reach the Asset's Entity here,
 * at read time, making an Asset's usage its inbound links like any other node.
 *
 * The join is scoped to {@link edgeTargetContainerId}: the Container the URL itself named (ADR-0080), which
 * is the source's own whenever the picture came from home. A hash alone still never crosses — identical
 * bytes in two Containers share a hash but not an Entity, and each URL names exactly one of them.
 *
 * The Asset's own row rides along under the read filter, so {@link foreignNodes} needs no second
 * query keyed on however many Assets the World's documents happen to draw from.
 */
function assetGraphEdges(db: Db, access: EntityAccess, worldId: string): AssetEdgeRow[] {
  return db
    .select({
      source: entityEdges.sourceEntityId,
      target: assetIndex.entityId,
      descriptor: entityEdges.descriptor,
      decor: entityEdges.decor,
      name: entities.name,
      types: entities.types,
      targetContainerId: entities.containerId,
    })
    .from(entityEdges)
    .innerJoin(
      assetIndex,
      and(eq(assetIndex.hash, entityEdges.targetId), sql`${assetIndex.containerId} = ${edgeTargetContainerId}`),
    )
    .innerJoin(entities, and(eq(entities.id, assetIndex.entityId), access.listFilter))
    .where(and(eq(entityEdges.containerId, worldId), eq(entityEdges.targetKind, 'asset')))
    .orderBy(asc(entityEdges.sourceEntityId), asc(assetIndex.entityId), asc(entityEdges.descriptor))
    .all();
}
