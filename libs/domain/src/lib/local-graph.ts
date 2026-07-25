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
 * The deepest neighbourhood the read will walk — a hop multiplies the payload by the average degree,
 * and past this the World Graph page is the right surface (ADR-0072).
 */
export const LOCAL_GRAPH_MAX_DEPTH = 5;

/**
 * `GET /entities/:id/graph?depth=N`. Depth is clamped into `[1, {@link LOCAL_GRAPH_MAX_DEPTH}]` rather
 * than refused (ADR-0072); only non-numeric input is a 400.
 */
export const localGraphQuerySchema = z.object({
  depth: z.coerce
    .number()
    .int()
    .transform((n) => Math.min(Math.max(n, 1), LOCAL_GRAPH_MAX_DEPTH))
    .default(LOCAL_GRAPH_DEFAULT_DEPTH),
});

export type LocalGraphQuery = z.infer<typeof localGraphQuerySchema>;

/**
 * One Entity's neighbourhood, in the {@link WorldGraph} shape so one renderer draws both (ADR-0072).
 * The walk crosses **semantic** edges only (ADR-0069), which is what makes the result connected — decor
 * edges between included nodes are still carried, flagged, for the client's reveal.
 */
export interface LocalGraph {
  readonly center: string;
  /** The *resolved* hop bound — clamped, so the reader's control shows what was actually walked. */
  readonly depth: number;
  readonly nodes: readonly LinkedEntity[];
  readonly edges: readonly WorldGraphEdge[];
}
