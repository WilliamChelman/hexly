import { Point } from '@hexly/domain';

/**
 * The viewport transform for the map renderer: an immutable pan (`offset`, in
 * screen pixels) and `zoom` (scale). World/pixel coordinates come from the
 * domain hex geometry; the Camera places them on screen and back, so pan and
 * zoom never touch the hex math itself.
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
   * A camera zoomed by `factor` about a fixed screen anchor (the cursor). The
   * world point under the anchor stays under it, so wheel-zoom feels like it
   * pulls toward the pointer rather than the origin.
   */
  zoomAt(anchor: Point, factor: number): Camera {
    const world = this.screenToWorld(anchor);
    const zoom = this.zoom * factor;
    return new Camera(zoom, {
      x: anchor.x - world.x * zoom,
      y: anchor.y - world.y * zoom,
    });
  }
}
