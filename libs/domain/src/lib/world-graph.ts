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
  /**
   * A **Decor Link** (ADR-0069): presentation, not worldbuilding meaning. The graph hides decor edges
   * behind an ephemeral "show decor links" reveal, and computes orphans *after* filtering them — so an
   * Asset whose only edges are decor falls out of the default graph as an ordinary orphan.
   */
  readonly decor: boolean;
}

/**
 * One end of a link, as a graph draws it: a {@link LinkedEntity} plus, when it lives in another
 * **Container**, the Container it lives in.
 */
export interface WorldGraphNode extends LinkedEntity {
  /**
   * A **Foreign node** (ADR-0080): the Container this Entity actually lives in, present only when that
   * is not the graph's own. It is both the mark — the client draws such a node as living elsewhere —
   * and what a click navigates by, since Entity URLs are World-scoped (ADR-0028) and this graph's own
   * World would be the wrong shell.
   */
  readonly foreignContainerId?: string;
}

/**
 * `GET /worlds/:id/graph`. Nodes are every Entity of the World the viewer can read — orphans
 * included, Assets among them (ADR-0065). An Asset's usage is its inbound links, so its
 * content-addressed edges resolve to it as an ordinary node; the client's generic show-orphans
 * toggle keeps unlinked Entities of any type (bulk-minted Assets included) out of the picture by
 * default.
 *
 * A link leaving the Container adds one more kind: a **Foreign node**, carrying
 * {@link WorldGraphNode.foreignContainerId}. The World's *own* nodes are still exactly its own
 * Entities — a Foreign node is drawn, never counted among them.
 */
export interface WorldGraph {
  readonly nodes: readonly WorldGraphNode[];
  readonly edges: readonly WorldGraphEdge[];
}
