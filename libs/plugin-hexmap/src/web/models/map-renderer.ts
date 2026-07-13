import type { Axial, HexMap, HexWrite, Point } from '../../lib';
import type { Camera } from '../utils/camera';
import type { Selection } from '../services/hexmap-store';

/**
 * A live marquee box: the two world-space corners (`a` the drag origin, `b` the
 * cursor) of the rectangle the Marquee Subtool is dragging (ADR-0017). World-space,
 * unnormalised — the renderer normalises and projects it.
 */
export interface MarqueeOverride {
  readonly a: Point;
  readonly b: Point;
}

/**
 * The optional, per-frame inputs to {@link MapRenderer.render} beyond the camera,
 * document, and hover: the Selection set to highlight, plus the live preview
 * overrides that ride on top of the committed document without mutating it. All
 * optional — omit the ones a frame doesn't need.
 */
export interface RenderOverrides {
  /**
   * Live label-drag preview: a `labelId → world position` map overriding where
   * those labels draw. An absent id draws as stored.
   */
  readonly labelPositions?: ReadonlyMap<string, Point> | null;
  /** The Selection set to highlight — the committed set, or a marquee's live preview. */
  readonly selections?: readonly Selection[];
  /**
   * Preview a live move by overlaying the planner's resolved hex writes: each
   * `{ coord, hex }` draws that record at `coord`, and a `{ coord, hex: null }`
   * leaves the coordinate Void.
   */
  readonly movePreview?: readonly HexWrite[] | null;
  /** Preview the live marquee rectangle being dragged (ADR-0017). */
  readonly marquee?: MarqueeOverride | null;
  /**
   * The destination cells a live group move is refused at — washed in the danger
   * ink so the drag reads as blocked.
   */
  readonly blockedCells?: readonly Axial[];
  /**
   * Live region-drag preview: a `regionId → translated membership` map overriding
   * where those regions' footprints draw — both the coloured border and the
   * selection tint. An absent id draws from the stored membership.
   */
  readonly regionPreview?: ReadonlyMap<string, Record<string, true>> | null;
}

/**
 * The seam between the editor and whatever draws the map (ADR-0003). A renderer
 * owns its drawing surface and paints one frame on demand for a given camera
 * transform.
 */
export interface MapRenderer {
  /** Match the drawing surface to the given CSS-pixel size. */
  resize(width: number, height: number): void;
  /**
   * Paint one frame: the painted hexes, the culled grid, an optional hover, and the
   * optional {@link RenderOverrides} previews.
   */
  render(camera: Camera, doc: HexMap, hover: Axial | null, overrides?: RenderOverrides): void;
  /**
   * The id of the Label drawn under screen `point` (topmost wins), or `null`.
   * Reflects the most recent {@link render}, so hit-testing matches what the user
   * sees.
   */
  labelAt(point: Point): string | null;
  /**
   * Re-read the themed colours from CSS. Cheap but not free (a style recalc): call
   * it only when the active theme changes, not per frame.
   */
  refreshTheme(): void;
}
