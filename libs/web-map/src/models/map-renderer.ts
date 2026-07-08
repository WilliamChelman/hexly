import type { Axial, HexMap, HexWrite, Point } from '@hexly/domain';
import type { Camera } from '../utils/camera';
import type { Selection } from '../services/hexmap-store';

/**
 * A live marquee box: the two world-space corners (`a` the drag origin, `b` the
 * cursor) of the rectangle the Marquee Subtool is dragging (ADR-0017). Passed to
 * {@link MapRenderer.render} so the box previews live without touching the
 * document, the same discipline as the label/hex drag overrides. World-space so
 * it tracks the content under pan/zoom; the renderer normalises and projects it.
 */
export interface MarqueeOverride {
  readonly a: Point;
  readonly b: Point;
}

/**
 * The optional, per-frame inputs to {@link MapRenderer.render} beyond the camera,
 * document, and hover: the Selection set to highlight, plus the live *preview*
 * overrides that each ride on top of the committed document without mutating it
 * (issues #6, #30, ADR-0017). Bundled into one object so the render seam stays a
 * stable `camera, doc, hover, overrides` shape as new previews are added, rather
 * than growing another positional argument each time. All optional — omit the
 * ones a frame doesn't need.
 */
export interface RenderOverrides {
  /**
   * Live label-drag preview: a `labelId → world position` map overriding where
   * those labels draw, without cloning the document each frame (issues #6, #64).
   * A whole group of dragged labels rides here; an absent id draws as stored.
   */
  readonly labelPositions?: ReadonlyMap<string, Point> | null;
  /** The Selection set to highlight — the committed set, or a marquee's live preview. */
  readonly selections?: readonly Selection[];
  /**
   * Preview a live move by overlaying the planner's resolved hex writes (issue #30,
   * #64): each `{ coord, hex }` draws that record at `coord`, and a `{ coord, hex:
   * null }` leaves the coordinate Void. The single seam for previewing both a
   * single-hex drag and a whole-group translation — the canvas computes the plan
   * each frame and hands the writes here, so the renderer draws exactly what
   * releasing would commit, without cloning or mutating the document.
   */
  readonly movePreview?: readonly HexWrite[] | null;
  /** Preview the live marquee rectangle being dragged (ADR-0017). */
  readonly marquee?: MarqueeOverride | null;
  /**
   * The destination cells a live group move is refused at — washed in the danger
   * ink so the drag reads as blocked (CONTEXT.md → "blocked cells highlighted red";
   * ADR-0017, issue #64). A preview overlay only: the document is never mutated.
   */
  readonly blockedCells?: readonly Axial[];
  /**
   * Live region-drag preview: a `regionId → translated membership` map overriding
   * where those regions' footprints draw — both the coloured border and the
   * selection tint — without mutating the document (issue #64). An absent id draws
   * from the stored membership.
   */
  readonly regionPreview?: ReadonlyMap<string, Record<string, true>> | null;
}

/**
 * The seam between the editor and whatever draws the map. There is one Canvas 2D
 * implementation today; the interface exists so a WebGL backend can drop in
 * later without touching the rest of the app (ADR-0003). A renderer owns its
 * drawing surface and paints one frame on demand for a given camera transform.
 */
export interface MapRenderer {
  /** Match the drawing surface to the given CSS-pixel size. */
  resize(width: number, height: number): void;
  /**
   * Paint one frame: the painted hexes, the culled grid, an optional hover, and
   * the optional {@link RenderOverrides} (the selection highlight plus the live
   * label/hex/marquee previews) — each previewed without the caller rebuilding
   * the document each frame (issues #6, #30, ADR-0017).
   */
  render(
    camera: Camera,
    doc: HexMap,
    hover: Axial | null,
    overrides?: RenderOverrides,
  ): void;
  /**
   * The id of the Label drawn under screen `point` (topmost wins), or `null`.
   * Reflects the most recent {@link render}, so the canvas can hit-test clicks
   * against what the user sees — used to select and drag labels (issue #10).
   */
  labelAt(point: Point): string | null;
  /**
   * Re-read the themed colours from CSS. Cheap but not free (a style recalc), so
   * the caller invokes it only when the active theme changes — not per frame.
   */
  refreshTheme(): void;
}
