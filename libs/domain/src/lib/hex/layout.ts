import { Axial, hexRound } from './coordinates';

/** A point in renderer/pixel space. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Per-map hex orientation; pointy-top is the default (ADR-0003). */
export type Orientation = 'pointy' | 'flat';

/**
 * Everything the geometry needs to map between hexes and pixels: the
 * `orientation`, the per-axis hex `size` (centre→corner radius), and the pixel
 * `origin` that hex `(0, 0)` sits on. The renderer is parameterized by this.
 */
export interface Layout {
  readonly orientation: Orientation;
  readonly size: Point;
  readonly origin: Point;
}

const SQRT3 = Math.sqrt(3);

type Matrix = readonly [number, number, number, number];

/**
 * The geometry constants for one orientation, kept together so a hex shape lives
 * in a single place: the `forward` matrix (axial → unit pixel offset), its
 * `inverse` (pixel → fractional axial), and the corner `startAngle` in turns
 * (pointy corners at 30° + 60°·i, flat at 0° + 60°·i — what makes a pointy hex
 * point up and a flat hex point sideways). Red Blob Games convention.
 */
const ORIENTATIONS: Record<
  Orientation,
  { forward: Matrix; inverse: Matrix; startAngle: number }
> = {
  pointy: {
    forward: [SQRT3, SQRT3 / 2, 0, 3 / 2],
    inverse: [SQRT3 / 3, -1 / 3, 0, 2 / 3],
    startAngle: 0.5,
  },
  flat: {
    forward: [3 / 2, 0, SQRT3 / 2, SQRT3],
    inverse: [2 / 3, 0, -1 / 3, SQRT3 / 3],
    startAngle: 0,
  },
};

/** The pixel centre of a hex under the given layout. */
export function hexToPixel(layout: Layout, { q, r }: Axial): Point {
  const [f0, f1, f2, f3] = ORIENTATIONS[layout.orientation].forward;
  return {
    x: (f0 * q + f1 * r) * layout.size.x + layout.origin.x,
    y: (f2 * q + f3 * r) * layout.size.y + layout.origin.y,
  };
}

/** The hex containing the given pixel point under the layout. */
export function pixelToHex(layout: Layout, point: Point): Axial {
  const [b0, b1, b2, b3] = ORIENTATIONS[layout.orientation].inverse;
  const px = (point.x - layout.origin.x) / layout.size.x;
  const py = (point.y - layout.origin.y) / layout.size.y;
  return hexRound({ q: b0 * px + b1 * py, r: b2 * px + b3 * py });
}

/** The six pixel corners of a hex, in order, under the layout. */
export function hexCorners(layout: Layout, hex: Axial): Point[] {
  const centre = hexToPixel(layout, hex);
  const start = ORIENTATIONS[layout.orientation].startAngle;
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (2 * Math.PI * (i + start)) / 6;
    return {
      x: centre.x + layout.size.x * Math.cos(angle),
      y: centre.y + layout.size.y * Math.sin(angle),
    };
  });
}
