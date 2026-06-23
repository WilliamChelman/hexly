import { Axial } from './coordinates';
import { coordKey, Hex, HexMap } from './hex-map';

/**
 * The Map elements a move picks up and translates together (CONTEXT.md →
 * Selection). Domain-level, so the planner owns no store types: a move is
 * described by the coordinates, label ids, and region ids it carries.
 */
export interface MoveSelection {
  readonly hexes: Axial[];
  readonly labels: string[];
  readonly regions: string[];
}

/** What a move asks of the planner: the document, what's selected, and by how much. */
export interface MoveRequest {
  readonly document: HexMap;
  readonly selection: MoveSelection;
  /** The already-decided translation `(dq, dr)`; granularity is the caller's concern. */
  readonly offset: Axial;
}

/** One hex the plan rewrites: `hex: null` clears the coordinate back to Void. */
export interface HexWrite {
  readonly coord: Axial;
  readonly hex: Hex | null;
}

/**
 * A resolved move (CONTEXT.md → "a move never silently destroys content"): the
 * hex writes/clears, label position changes, and region-footprint shifts that,
 * applied together in one step, carry the selection by the offset. `labels` and
 * `regions` are empty for a single-hex move — they fill in with the group slice.
 */
export interface ResolvedMovePlan {
  readonly blocked: false;
  readonly hexes: HexWrite[];
  readonly labels: never[];
  readonly regions: never[];
}

/**
 * A move the planner refuses: the destination `cells` that can't take their
 * content, so the caller leaves the document untouched. Single-hex moves never
 * block (a drop onto an occupant swaps); blocking arrives with the group slice.
 */
export interface BlockedMovePlan {
  readonly blocked: true;
  readonly cells: Axial[];
}

/** Either a resolved move or a refusal — the one result every move flows through. */
export type MovePlan = ResolvedMovePlan | BlockedMovePlan;

/** Translate a coordinate by an offset. */
function shift(coord: Axial, offset: Axial): Axial {
  return { q: coord.q + offset.q, r: coord.r + offset.r };
}

/**
 * Plan a move of `selection` by `offset` over `document` (CONTEXT.md, ADR-0017):
 * the pure seam every move routes through. Returns a resolved plan of writes to
 * apply in one step, or a refusal naming the blocked cells. This slice resolves
 * the single-hex cases — drop onto Void moves; drop onto an occupied hex swaps
 * the two whole records — and never blocks. Region memberships are left untouched
 * (a Region is a coordinate overlay, not a property of the painted cell), which
 * falls out of no region being selected. A move that carries nothing — an empty
 * selection, or an origin that is itself Void — resolves to an empty (no-op) plan
 * rather than emitting a clear that would destroy the destination: the seam owns
 * its own preconditions so every caller, single-hex or group, is safe.
 */
export function planMove({ document, selection, offset }: MoveRequest): MovePlan {
  const noop: ResolvedMovePlan = { blocked: false, hexes: [], labels: [], regions: [] };
  const from = selection.hexes[0];
  if (!from) return noop;
  const moved = document.hexes[coordKey(from)];
  if (!moved) return noop;
  const to = shift(from, offset);
  const occupant = document.hexes[coordKey(to)];
  return {
    blocked: false,
    hexes: [
      { coord: to, hex: moved },
      { coord: from, hex: occupant ?? null },
    ],
    labels: [],
    regions: [],
  };
}
