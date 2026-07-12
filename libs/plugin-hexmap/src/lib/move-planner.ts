import { addAxial, Axial, subAxial } from './coordinates';
import { coordKey, Hex, HexMap, parseCoordKey, regionById } from './hex-map';

/**
 * The Map elements a move picks up and translates together (CONTEXT.md →
 * Selection). Labels are deliberately absent — they are free-positioned pixels
 * that never collide; the *caller* translates them by the equivalent pixels.
 */
export interface MoveSelection {
  readonly hexes: Axial[];
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
 * shifting every member by the move's offset. Replaces the region's whole
 * `hexes` map, so the caller writes it wholesale rather than diffing.
 */
export interface RegionWrite {
  readonly id: string;
  readonly hexes: Record<string, true>;
}

/**
 * A resolved move: the hex writes/clears and region-footprint shifts that,
 * applied together in one step, carry the selection by the offset.
 */
export interface ResolvedMovePlan {
  readonly blocked: false;
  readonly hexes: HexWrite[];
  readonly regions: RegionWrite[];
}

/**
 * A move the planner refuses: the destination `cells` that can't take their
 * content, so the caller leaves the document untouched. Single-hex moves never
 * block (a drop onto an occupant swaps).
 */
export interface BlockedMovePlan {
  readonly blocked: true;
  readonly cells: Axial[];
}

/** Either a resolved move or a refusal — the one result every move flows through. */
export type MovePlan = ResolvedMovePlan | BlockedMovePlan;

/**
 * Plan a move of `selection` by `offset` over `document` — the pure seam every
 * move routes through, single hex or whole group. Rigid translation: each
 * painted source is snapshotted, cleared, and rewritten at `source + offset`;
 * intra-group overlap writes rather than clears, so a cluster keeps its shape.
 * A destination occupied by a non-selected hex displaces that occupant to
 * `d − offset` (the single-hex swap is this with one member); the cell blocks
 * when another moving member is also landing there, and any blocked cell
 * refuses the whole move. Selected region footprints translate by the offset
 * and never block. A move carrying nothing resolves to an empty plan rather
 * than emitting destructive clears.
 */
export function planMove({ document, selection, offset }: MoveRequest): MovePlan {
  const sourceKeys = new Set(selection.hexes.map(coordKey));

  // Snapshot the painted sources in selection order; an unpainted (Void) source
  // carries nothing — it neither writes a destination nor clears an origin.
  const moves = selection.hexes.flatMap((source) => {
    const hex = document.hexes[coordKey(source)];
    if (!hex) return [];
    return [{ source, dest: addAxial(source, offset), hex }];
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
    const target = subAxial(dest, offset);
    const targetKey = coordKey(target);
    // `d − offset` is always the source this member is vacating, so it is free —
    // unless another moving member is *also* landing there, in which case the
    // displaced occupant has nowhere to go and the destination blocks.
    if (destKeys.has(targetKey)) {
      blocked.push(dest);
    } else {
      hexes.push({ coord: target, hex: occupant });
      claimed.add(targetKey);
    }
  }

  // Any blocked cell refuses the whole move: the caller leaves the document untouched.
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
      moved[coordKey(addAxial(parseCoordKey(key), offset))] = true;
    }
    return [{ id, hexes: moved }];
  });

  return { blocked: false, hexes, regions };
}
