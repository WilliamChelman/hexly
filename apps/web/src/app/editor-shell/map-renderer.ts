import { Axial, hexCorners, hexesInRect, Layout } from '@hexly/domain';
import { Camera } from './camera';

/**
 * The seam between the editor and whatever draws the map. There is one Canvas 2D
 * implementation today; the interface exists so a WebGL backend can drop in
 * later without touching the rest of the app (ADR-0003). A renderer owns its
 * drawing surface and paints one frame on demand for a given camera transform.
 */
export interface MapRenderer {
  /** Match the drawing surface to the given CSS-pixel size. */
  resize(width: number, height: number): void;
  /** Paint one frame: the culled grid plus an optional hovered hex. */
  render(camera: Camera, hover: Axial | null): void;
}

/** Read a themed CSS custom property off an element, trimmed. */
function cssVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/**
 * Draws the infinite hex plane onto a `<canvas>` using the 2D context. Each
 * frame it culls to the visible viewport (so it never iterates the infinite
 * plane), paints Void as a flat themed background, and strokes the grid for the
 * hexes that intersect the view. Colours come from CSS custom properties so it
 * tracks the active theme (ADR-0006).
 */
export class Canvas2dMapRenderer implements MapRenderer {
  private width = 0;
  private height = 0;
  private readonly dpr =
    typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly layout: Layout,
  ) {}

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  render(camera: Camera, hover: Axial | null): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx || this.width === 0 || this.height === 0) return;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Void: a flat neutral fill across the whole surface (CONTEXT.md → Void).
    ctx.fillStyle = cssVar(this.canvas, '--canvas-bg') || '#1b1b1b';
    ctx.fillRect(0, 0, this.width, this.height);

    const visible = this.visibleWorldRect(camera);

    // Hover highlight first, so the grid lines draw crisply on top of it.
    if (hover) {
      ctx.fillStyle = cssVar(this.canvas, '--gold-soft') || 'rgba(212,175,55,.3)';
      this.tracePath(ctx, camera, hover);
      ctx.fill();
    }

    ctx.lineWidth = 1;
    ctx.strokeStyle = cssVar(this.canvas, '--hex-line') || '#888';
    for (const hex of hexesInRect(this.layout, visible)) {
      this.tracePath(ctx, camera, hex);
      ctx.stroke();
    }
  }

  /** The world-space rectangle currently visible through the camera. */
  private visibleWorldRect(camera: Camera) {
    const topLeft = camera.screenToWorld({ x: 0, y: 0 });
    const bottomRight = camera.screenToWorld({ x: this.width, y: this.height });
    return {
      minX: topLeft.x,
      minY: topLeft.y,
      maxX: bottomRight.x,
      maxY: bottomRight.y,
    };
  }

  /** Lay down the screen-space polygon path for one hex (no fill/stroke). */
  private tracePath(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    hex: Axial,
  ): void {
    const corners = hexCorners(this.layout, hex).map((c) =>
      camera.worldToScreen(c),
    );
    ctx.beginPath();
    corners.forEach((p, i) =>
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y),
    );
    ctx.closePath();
  }
}
