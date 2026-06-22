import { Axial } from './coordinates';
import { hexToPixel, Layout, pixelToHex, Point } from './layout';

/** An axis-aligned rectangle in world/pixel space (e.g. the visible viewport). */
export interface Rect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * The axis-aligned {@link Rect} spanning two corner points, in whichever order —
 * a drag from bottom-right to top-left yields the same rect as top-left to
 * bottom-right. The single place two-corner→Rect normalisation lives, shared by
 * the marquee's world-space hit-test (the canvas) and its screen-space outline
 * (the renderer) so the box geometry is defined once and the two can't drift.
 */
export function rectFromCorners(a: Point, b: Point): Rect {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

/**
 * Every hex intersecting the rectangle — the viewport-culling query the renderer
 * runs each frame so it paints only what's on screen, not the infinite plane
 * (ADR-0003). Over-includes by at most a one-hex margin (cheap and safe); never
 * misses a hex that is actually visible.
 */
export function hexesInRect(layout: Layout, rect: Rect): Axial[] {
  const corners: Point[] = [
    { x: rect.minX, y: rect.minY },
    { x: rect.maxX, y: rect.minY },
    { x: rect.minX, y: rect.maxY },
    { x: rect.maxX, y: rect.maxY },
  ].map((p) => {
    const h = pixelToHex(layout, p);
    return { x: h.q, y: h.r };
  });

  // The rect maps to a sheared parallelogram in hex space; its axial bounding
  // box (padded by one) contains every hex whose centre could fall inside.
  const qs = corners.map((c) => c.x);
  const rs = corners.map((c) => c.y);
  const qMin = Math.min(...qs) - 1;
  const qMax = Math.max(...qs) + 1;
  const rMin = Math.min(...rs) - 1;
  const rMax = Math.max(...rs) + 1;

  const result: Axial[] = [];
  for (let q = qMin; q <= qMax; q++) {
    for (let r = rMin; r <= rMax; r++) {
      const c = hexToPixel(layout, { q, r });
      // A hex extends at most `size` from its centre, so a centre within `size`
      // of the rect means the hex touches it.
      if (
        c.x >= rect.minX - layout.size.x &&
        c.x <= rect.maxX + layout.size.x &&
        c.y >= rect.minY - layout.size.y &&
        c.y <= rect.maxY + layout.size.y
      ) {
        result.push({ q, r });
      }
    }
  }
  return result;
}
