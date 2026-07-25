import { Inject, Injectable } from '@nestjs/common';
import { WorldGraph } from '@hexly/domain';
import { entityAccess } from '../acl/entity-access';
import { worldAccess } from '../acl/world-access';
import { DB, Db } from '../db/db';
import { graphEdges, graphNodes } from '../entities/utils/graph-reads';

/**
 * The World Graph read (ADR-0046): a World's readable Entities as nodes, the derived edge index
 * between them as edges. Assets are ordinary nodes (ADR-0065): their usage is their inbound links,
 * so the content-addressed asset edges are resolved to the Asset's Entity here, at read time.
 *
 * Unlike the other edge surfaces, **both** endpoints are access-filtered here: an edge the viewer
 * cannot fully see is dropped, not rendered as a dangling target. Each edge carries its **Decor Link**
 * flag (ADR-0069); the payload is unfiltered on it — the client subdues decor behind an ephemeral reveal
 * and computes orphans *after*, so the access filter always runs before the decor filter, and a
 * decor-only Asset falls out as an ordinary orphan with no asset-specific code.
 *
 * The node and edge reads themselves live in `entities/utils/graph-reads`, shared with the Local Graph
 * (ADR-0072) — the same projection, bounded to one Entity's neighbourhood.
 */
@Injectable()
export class WorldGraphService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** The whole readable World. `null` when the World is unreachable — the 404 gate. */
  graph(userId: string, worldId: string): WorldGraph | null {
    if (!worldAccess(this.db, userId).decideMeta(worldId)?.reachable) return null;
    const nodes = graphNodes(this.db, entityAccess(this.db, userId), worldId);
    return {
      nodes,
      edges: graphEdges(this.db, worldId, new Set(nodes.map((n) => n.id))),
    };
  }
}
