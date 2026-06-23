/**
 * Hex coordinates for the infinite sparse plane (see CONTEXT.md, ADR-0003).
 *
 * Axial `(q, r)` is the storage and addressing coordinate — signed ints, so the
 * plane extends in every direction for free. Cube `(x, y, z)` is the transient
 * form used for distance/range/line algorithms; it always satisfies the
 * constraint `x + y + z === 0`.
 */

/** A hex address on the infinite plane. */
export interface Axial {
  readonly q: number;
  readonly r: number;
}

/** Cube coordinate; the three components always sum to zero. */
export interface Cube {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Convert an axial coordinate to its cube form. */
export function axialToCube({ q, r }: Axial): Cube {
  return { x: q, y: -q - r, z: r };
}

/** Convert a cube coordinate back to axial. */
export function cubeToAxial({ x, z }: Cube): Axial {
  return { q: x, r: z };
}

/**
 * Round a fractional axial (e.g. the result of a pixel→hex conversion) to the
 * nearest whole hex. Rounds in cube space and corrects the single most-rounded
 * component so the `x + y + z === 0` constraint is preserved.
 */
export function hexRound(fractional: Axial): Axial {
  const { x, y, z } = axialToCube(fractional);

  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);

  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);

  if (dx > dy && dx > dz) {
    rx = -ry - rz;
  } else if (dy > dz) {
    ry = -rx - rz;
  } else {
    rz = -rx - ry;
  }

  // `+ 0` collapses any `-0` produced by Math.round into a plain `0`.
  return cubeToAxial({ x: rx + 0, y: ry + 0, z: rz + 0 });
}

/**
 * The six axial directions, ordered counter-clockwise starting due "east"
 * (`+q`). Shared by `neighbors` and, later, edge/vertex identity so callers can
 * address a hex's sides by a stable direction index 0–5.
 */
const DIRECTIONS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

/** The six hexes sharing an edge with the given one, in `DIRECTIONS` order. */
export function neighbors({ q, r }: Axial): Axial[] {
  return DIRECTIONS.map((d) => ({ q: q + d.q, r: r + d.r }));
}

/** Translate `coord` by `offset` — the shared `(q,r) + (dq,dr)` every move uses. */
export function addAxial(coord: Axial, offset: Axial): Axial {
  return { q: coord.q + offset.q, r: coord.r + offset.r };
}

/** Translate `coord` by the inverse `offset` — `(q,r) − (dq,dr)`. */
export function subAxial(coord: Axial, offset: Axial): Axial {
  return { q: coord.q - offset.q, r: coord.r - offset.r };
}

/** The number of single-hex steps between two hexes (cube/Manhattan metric). */
export function distance(a: Axial, b: Axial): number {
  const ac = axialToCube(a);
  const bc = axialToCube(b);
  return (
    (Math.abs(ac.x - bc.x) + Math.abs(ac.y - bc.y) + Math.abs(ac.z - bc.z)) / 2
  );
}
