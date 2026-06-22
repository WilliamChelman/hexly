import { Axial } from './coordinates';
import { hexesInRect, Rect } from './culling';
import { coordKey, HexMap } from './hex-map';
import { hexToPixel, Layout, Point } from './layout';

/**
 * What a marquee box-selection contains (CONTEXT.md → Marquee, ADR-0017): the
 * painted Hex coordinates and the Label ids whose anchor point falls inside the
 * rectangle. Regions are deliberately absent — a Region has no single position,
 * so it is never marquee-selectable.
 */
export interface MarqueeHits {
  readonly hexes: Axial[];
  readonly labels: string[];
}

/** Whether `point` lies within the (already-normalised) world rectangle. */
function inRect(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.minX &&
    point.x <= rect.maxX &&
    point.y >= rect.minY &&
    point.y <= rect.maxY
  );
}

/**
 * The painted Hexes and Labels a world-space marquee `rect` selects under
 * `layout` (CONTEXT.md → Marquee). A Hex counts when its pixel centre falls
 * inside the rect; a Label when its anchor `position` does. Pure: no canvas
 * dependency, so the canvas can box-select by feeding the dragged rect through
 * here. Walks only the hexes the `rect` could contain — the same
 * viewport-bounded cull the renderer runs each frame ({@link hexesInRect}) —
 * keeping the painted ones whose centre is actually inside, so a live marquee
 * drag costs the box's area rather than the whole (possibly huge) document.
 * Regions are never returned.
 */
export function marqueeHits(layout: Layout, doc: HexMap, rect: Rect): MarqueeHits {
  const hexes: Axial[] = [];
  for (const coord of hexesInRect(layout, rect)) {
    if (!doc.hexes[coordKey(coord)]) continue; // skip Void — only painted hexes select
    if (inRect(rect, hexToPixel(layout, coord))) hexes.push(coord);
  }
  const labels = doc.labels
    .filter((label) => inRect(rect, label.position))
    .map((label) => label.id);
  return { hexes, labels };
}
