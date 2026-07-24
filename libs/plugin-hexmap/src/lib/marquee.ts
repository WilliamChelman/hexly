import { Axial } from './coordinates';
import { hexesInRect, Rect } from './culling';
import { coordKey, HexMap } from './hex-map';
import { hexToPixel, Layout, Point } from './layout';

/**
 * What a marquee box-selection contains (CONTEXT.md → Marquee): the painted Hex
 * coordinates and the Label ids whose anchor point falls inside the rectangle.
 * Regions are never included — a Region has no single position.
 */
export interface MarqueeHits {
  readonly hexes: Axial[];
  readonly labels: string[];
}

/** Whether `point` lies within the (already-normalised) world rectangle. */
function inRect(rect: Rect, point: Point): boolean {
  return point.x >= rect.minX && point.x <= rect.maxX && point.y >= rect.minY && point.y <= rect.maxY;
}

/**
 * The painted Hexes and Labels a world-space marquee `rect` selects under
 * `layout`. A Hex counts when its pixel centre falls inside the rect; a Label
 * when its anchor `position` does. Regions are never returned. Costs the box's
 * area, not the document's size ({@link hexesInRect}).
 */
export function marqueeHits(layout: Layout, doc: HexMap, rect: Rect): MarqueeHits {
  const hexes: Axial[] = [];
  for (const coord of hexesInRect(layout, rect)) {
    if (!doc.hexes[coordKey(coord)]) continue; // skip Void — only painted hexes select
    if (inRect(rect, hexToPixel(layout, coord))) hexes.push(coord);
  }
  const labels = doc.labels.filter((label) => inRect(rect, label.position)).map((label) => label.id);
  return { hexes, labels };
}
