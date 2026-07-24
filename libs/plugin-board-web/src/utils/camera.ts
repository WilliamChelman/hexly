import { Point, Size } from '@hexly/plugin-board';

/**
 * The viewport transform for the board surface: an immutable pan (`offset`, in screen pixels) and
 * `zoom` (scale). The free-positioned twin of the Hex Map's camera (#263) — a Board Element sits at a
 * world point, and this maps world ⇆ screen so the plane pans and zooms.
 *
 * `screen = world * zoom + offset`.
 */
export class Camera {
  private constructor(
    readonly zoom: number,
    readonly offset: Point,
  ) {}

  /** The identity camera: no pan, no zoom. */
  static initial(): Camera {
    return new Camera(1, { x: 0, y: 0 });
  }

  /** Where a world point lands on screen. */
  worldToScreen(world: Point): Point {
    return {
      x: world.x * this.zoom + this.offset.x,
      y: world.y * this.zoom + this.offset.y,
    };
  }

  /** Where a screen point sits in world space. */
  screenToWorld(screen: Point): Point {
    return {
      x: (screen.x - this.offset.x) / this.zoom,
      y: (screen.y - this.offset.y) / this.zoom,
    };
  }

  /** A camera panned by a screen-space drag delta. */
  panBy(dx: number, dy: number): Camera {
    return new Camera(this.zoom, {
      x: this.offset.x + dx,
      y: this.offset.y + dy,
    });
  }

  /**
   * A camera zoomed by `factor` about a fixed screen anchor (the cursor): the world point under the
   * anchor stays under it.
   */
  zoomAt(anchor: Point, factor: number): Camera {
    return this.zoomTo(anchor, this.zoom * factor);
  }

  /**
   * A camera at exactly `zoom` about a fixed screen anchor — {@link zoomAt} with the target scale given
   * outright, so a clamped zoom lands *on* its bound instead of a factor's float approximation of it.
   */
  zoomTo(anchor: Point, zoom: number): Camera {
    const world = this.screenToWorld(anchor);
    return new Camera(zoom, {
      x: anchor.x - world.x * zoom,
      y: anchor.y - world.y * zoom,
    });
  }
}

/**
 * The camera that frames every element's world box in the viewport (the zoom cluster's fit action):
 * the content bounding box centred, zoomed to fit inside `padding` screen pixels of breathing room on
 * each side, with the zoom clamped to `[minZoom, maxZoom]` — the caller passes its policy cap (fitting
 * one small element must not blow the view up to 400%). `null` for an empty board: nothing to frame,
 * the caller keeps its reset behaviour. Pure, so the fit math is unit-testable apart from the canvas.
 */
export function fitCamera(
  elements: readonly { position: Point; size: Size }[],
  viewport: Size,
  options: { padding: number; minZoom: number; maxZoom: number },
): Camera | null {
  if (elements.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { position, size } of elements) {
    minX = Math.min(minX, position.x);
    minY = Math.min(minY, position.y);
    maxX = Math.max(maxX, position.x + size.width);
    maxY = Math.max(maxY, position.y + size.height);
  }
  // A viewport narrower than its padding still fits at *some* positive scale rather than dividing by ≤ 0.
  const availableWidth = Math.max(1, viewport.width - 2 * options.padding);
  const availableHeight = Math.max(1, viewport.height - 2 * options.padding);
  const raw = Math.min(availableWidth / (maxX - minX), availableHeight / (maxY - minY));
  const zoom = Math.min(options.maxZoom, Math.max(options.minZoom, raw));
  const centre = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  // Scale about the world origin first, then pan the content centre to the viewport centre.
  return Camera.initial()
    .zoomTo({ x: 0, y: 0 }, zoom)
    .panBy(viewport.width / 2 - centre.x * zoom, viewport.height / 2 - centre.y * zoom);
}
