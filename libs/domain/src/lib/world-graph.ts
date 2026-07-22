/**
 * The World Graph: a World's Entities as nodes, their Entity Links as edges (ADR-0046).
 * A projection of the derived edge index, resolved per viewer — see `CONTEXT.md → World Graph`.
 */

import { LinkedEntity } from './entity-edges';

/**
 * One `entity → entity` link, by id. Both endpoints are nodes of the same graph: an edge whose
 * source or target the viewer cannot read is absent, not dangling. `descriptor` is the Link
 * Descriptor, which the client renders as the edge's label.
 */
export interface WorldGraphEdge {
  readonly source: string;
  readonly target: string;
  readonly descriptor: string | null;
}

/**
 * `GET /worlds/:id/graph`. Nodes are every Entity of the World the viewer can read — orphans
 * included, Assets among them (ADR-0065). An Asset's usage is its inbound links, so its
 * content-addressed edges resolve to it as an ordinary node; the client's generic show-orphans
 * toggle keeps unlinked Entities of any type (bulk-minted Assets included) out of the picture by
 * default.
 */
export interface WorldGraph {
  readonly nodes: readonly LinkedEntity[];
  readonly edges: readonly WorldGraphEdge[];
}
