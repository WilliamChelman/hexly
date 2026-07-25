/**
 * The Local Graph: the **World Graph** narrowed to one Entity's neighbourhood (ADR-0072).
 * Same nodes-and-edges projection of the derived edge index, bounded by a hop **depth** the reader
 * sets — see `CONTEXT.md → Local Graph`.
 */

import * as z from 'zod';
import { LinkedEntity } from './entity-edges';
import { WorldGraphEdge } from './world-graph';

/** One hop: the centre and what it links to directly — the depth a panel opens at. */
export const LOCAL_GRAPH_DEFAULT_DEPTH = 1;

/**
 * The deepest neighbourhood the read will walk. A hop multiplies the payload by the average degree,
 * so the ceiling is what keeps "depth 9" on a hub Entity from asking for the whole World through a
 * panel-sized surface; past it the World Graph page is the right surface.
 */
export const LOCAL_GRAPH_MAX_DEPTH = 5;

/**
 * `GET /entities/:id/graph?depth=N`. An absent `depth` is {@link LOCAL_GRAPH_DEFAULT_DEPTH}; one over
 * the ceiling is clamped rather than refused, the way a list `limit` is — a reader asking for more than
 * exists wants everything, not a 400.
 */
export const localGraphQuerySchema = z.object({
  depth: z.coerce
    .number()
    .int()
    .positive()
    .transform((n) => Math.min(n, LOCAL_GRAPH_MAX_DEPTH))
    .default(LOCAL_GRAPH_DEFAULT_DEPTH),
});

export type LocalGraphQuery = z.infer<typeof localGraphQuerySchema>;

/**
 * One Entity's neighbourhood, in the {@link WorldGraph} shape so one renderer draws both: every node
 * reachable from `center` within `depth` hops, and every edge between the nodes that survived.
 *
 * Traversal walks **semantic** edges only (ADR-0069): the Local Graph is a relation surface, so a
 * Thumbnail or a prose image never widens the neighbourhood. Decor edges *between* included nodes are
 * still carried, flag intact, for the client's reveal — so revealing decor annotates the picture and
 * never grows it, and the graph stays connected by construction (no orphans to filter).
 *
 * `center` and `depth` echo the resolved read back: `depth` is the clamped one, which is what the
 * reader's control must show.
 */
export interface LocalGraph {
  /** The Entity the neighbourhood is drawn around — always a node, since the read 404s otherwise. */
  readonly center: string;
  /** The resolved hop bound, clamped to {@link LOCAL_GRAPH_MAX_DEPTH}. */
  readonly depth: number;
  readonly nodes: readonly LinkedEntity[];
  readonly edges: readonly WorldGraphEdge[];
}
