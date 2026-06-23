import { Axial } from './coordinates';
import { coordKey, Hex, HexMap, parseCoordKey, regionById } from './hex-map';

/**
 * The Map elements a move picks up and translates together (CONTEXT.md →
 * Selection). Domain-level, so the planner owns no store types: a move is
 * described by the coordinates, label ids, and region ids it carries. Labels are
 * carried by the *caller* (they are free-positioned pixels, never collide, and so
 * have no part in the coordinate-space collision logic this planner owns) — the
 * planner reads only `hexes` and `regions`.
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
 * One region's translated membership footprint: the new `(q,r) → true` set after
 * shifting every member by the move's offset (CONTEXT.md → "each selected Region's
 * membership footprint shifts by the offset"). Replaces the region's whole `hexes`
 * map, so the caller writes it wholesale rather than diffing.
 */
export interface RegionWrite {
  readonly id: string;
  readonly hexes: Record<string, true>;
}

/**
 * A resolved move (CONTEXT.md → "a move never silently destroys content"): the
 * hex writes/clears and region-footprint shifts that, applied together in one
 * step, carry the selection by the offset. `regions` is empty when no region is
 * selected (the single-hex and hexes-only group cases). Labels are not here — the
 * caller translates them by the equivalent pixels, since they never collide.
 */
export interface ResolvedMovePlan {
  readonly blocked: false;
  readonly hexes: HexWrite[];
  readonly regions: RegionWrite[];
}

/**
 * A move the planner refuses: the destination `cells` that can't take their
 * content, so the caller leaves the document untouched. A cell blocks when the
 * non-selected hex sitting on it cannot be displaced by the inverse offset —
 * because the moving group is itself landing on `d − offset` (a self-overlapping
 * nudge) or another non-selected hex already holds it. Single-hex moves never
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

/** Translate a coordinate by the inverse offset — where a displaced occupant goes. */
function unshift(coord: Axial, offset: Axial): Axial {
  return { q: coord.q - offset.q, r: coord.r - offset.r };
}

/**
 * Plan a move of `selection` by `offset` over `document` (CONTEXT.md, ADR-0017):
 * the pure seam every move routes through — single hex or whole group. Returns a
 * resolved plan of writes to apply in one step, or a refusal naming the blocked
 * cells.
 *
 * **Rigid translation.** Each selected, painted source is snapshotted, its origin
 * cleared, and its whole record written at `source + offset`. The cluster keeps
 * its internal shape, and intra-group overlap just works: a source that is also
 * another member's destination is written, not cleared, so shifting a blob by one
 * cell never fights itself.
 *
 * **Group collision.** A destination occupied by a hex *outside* the selection
 * displaces that occupant by the inverse offset, to `d − offset`, when that cell
 * is free (Void or a vacated source). The clean single-hex swap is exactly this
 * with one member. Where `d − offset` is instead claimed by the moving group (a
 * self-overlapping nudge) or by another non-selected hex, that destination is
 * **blocked**; any blocked cell blocks the whole move, returning `{ blocked,
 * cells }` so the caller is a no-op.
 *
 * **Regions.** Each selected region's footprint translates by the offset (every
 * member key `(q,r) → (q+dq, r+dr)`); region membership is otherwise untouched, so
 * "regions stay put" falls out of no region being selected. Region footprints
 * never collide — regions overlap freely — so they never block.
 *
 * A move that carries nothing — no painted source and no selected region — resolves
 * to an empty (no-op) plan rather than emitting clears that would destroy
 * untouched destinations: the seam owns its own preconditions so every caller is
 * safe.
 */
export function planMove({ document, selection, offset }: MoveRequest): MovePlan {
  const sourceKeys = new Set(selection.hexes.map(coordKey));

  // Snapshot the painted sources in selection order: an unpainted (Void) source
  // carries nothing, so it is skipped — it neither writes a destination nor clears
  // an origin (the single-hex "origin is Void" no-op generalises to the group).
  const moves = selection.hexes.flatMap((source) => {
    const hex = document.hexes[coordKey(source)];
    if (!hex) return [];
    return [{ source, dest: shift(source, offset), hex }];
  });
  const destKeys = new Set(moves.map((m) => coordKey(m.dest)));

  // Destination writes, in selection order: each moved record at its destination.
  // A destination that coincides with a source (intra-group) is a write here and
  // so will not be re-cleared below.
  const hexes: HexWrite[] = moves.map((m) => ({ coord: m.dest, hex: m.hex }));
  const claimed = new Set(destKeys);

  // Group collisions: every destination occupied by a hex *outside* the selection
  // displaces that occupant to `d − offset`, or blocks when that target is not free.
  const blocked: Axial[] = [];
  for (const { dest } of moves) {
    const destKey = coordKey(dest);
    // Intra-group overlap is not a collision: a destination landing on a selected
    // source is the group shifting onto its own path.
    if (sourceKeys.has(destKey)) continue;
    const occupant = document.hexes[destKey];
    if (!occupant) continue;
    const target = unshift(dest, offset);
    const targetKey = coordKey(target);
    const targetOccupied =
      !!document.hexes[targetKey] && !sourceKeys.has(targetKey);
    // The target is free when nothing else will hold it: the moving group is not
    // landing there, and no non-selected hex already sits there (a vacated source
    // is free — it is being cleared this same move).
    if (destKeys.has(targetKey) || targetOccupied) {
      blocked.push(dest);
    } else {
      hexes.push({ coord: target, hex: occupant });
      claimed.add(targetKey);
    }
  }

  // Any blocked cell refuses the whole move: the caller leaves the document
  // untouched (CONTEXT.md → "any blocked cell blocks the whole move").
  if (blocked.length > 0) return { blocked: true, cells: blocked };

  // Clear every source nothing reclaimed (not a group destination, not where a
  // displaced occupant landed) back to Void.
  for (const { source } of moves) {
    if (!claimed.has(coordKey(source))) hexes.push({ coord: source, hex: null });
  }

  // Translate each selected region's footprint by the offset; an unknown region id
  // contributes nothing.
  const regions: RegionWrite[] = selection.regions.flatMap((id) => {
    const region = regionById(document, id);
    if (!region) return [];
    const moved: Record<string, true> = {};
    for (const key of Object.keys(region.hexes)) {
      moved[coordKey(shift(parseCoordKey(key), offset))] = true;
    }
    return [{ id, hexes: moved }];
  });

  return { blocked: false, hexes, regions };
}
