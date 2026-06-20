import {
  Axial,
  coordKey,
  FeatureId,
  featureLibrary,
  hexCorners,
  hexesInRect,
  hexToPixel,
  HexMap,
  Layout,
  terrainPalette,
  TerrainId,
} from '@hexly/domain';
import { Camera } from './camera';

/** The built-in features keyed by id, for a marker's path lookup. */
const FEATURE_BY_ID = new Map(featureLibrary.map((f) => [f.id, f]));
/** A marker's drawn size as a fraction of the on-screen hex radius. */
const MARKER_SCALE = 1.3;
/** A marker's stroke weight in screen pixels, held constant across zoom. */
const MARKER_STROKE = 1.6;
/**
 * The authoring viewBox the feature `path`s are drawn in: a 24×24 box, matching
 * the `<svg viewBox="0 0 24 24">` the UI icon components use. The marker is
 * scaled from this box and translated by its half (12) to centre it on the hex.
 */
const ICON_BOX = 24;

/**
 * The seam between the editor and whatever draws the map. There is one Canvas 2D
 * implementation today; the interface exists so a WebGL backend can drop in
 * later without touching the rest of the app (ADR-0003). A renderer owns its
 * drawing surface and paints one frame on demand for a given camera transform.
 */
export interface MapRenderer {
  /** Match the drawing surface to the given CSS-pixel size. */
  resize(width: number, height: number): void;
  /** Paint one frame: the painted hexes, the culled grid, and an optional hover. */
  render(camera: Camera, doc: HexMap, hover: Axial | null): void;
  /**
   * Re-read the themed colours from CSS. Cheap but not free (a style recalc), so
   * the caller invokes it only when the active theme changes — not per frame.
   */
  refreshTheme(): void;
}

/** The themed colours one frame needs, resolved from CSS custom properties. */
interface Palette {
  readonly void: string;
  readonly hover: string;
  readonly line: string;
  /** The ink a feature marker is stroked in, from `--feature-ink`. */
  readonly featureInk: string;
  /** One fill colour per terrain id, resolved from its `--terrain-*` token. */
  readonly terrain: Record<TerrainId, string>;
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
  /** The 2D context, fetched once — re-fetching it per frame is wasteful. */
  private readonly ctx: CanvasRenderingContext2D | null;
  /** Cached themed colours; refreshed only on a theme switch, not per frame. */
  private palette: Palette;
  /** Lazily-built `Path2D` per feature id — the geometry is constant, so cache it. */
  private readonly markerPaths = new Map<FeatureId, Path2D>();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly layout: Layout,
  ) {
    this.ctx = canvas.getContext('2d');
    this.palette = this.readPalette();
  }

  refreshTheme(): void {
    this.palette = this.readPalette();
  }

  /** Resolve the themed colours from CSS in a single style read (ADR-0006). */
  private readPalette(): Palette {
    const style = getComputedStyle(this.canvas);
    const read = (name: string, fallback: string): string =>
      style.getPropertyValue(name).trim() || fallback;
    const terrain = Object.fromEntries(
      terrainPalette.map((t) => [t.id, read(t.fill, '#888')]),
    ) as Record<TerrainId, string>;
    return {
      void: read('--canvas-bg', '#1b1b1b'),
      hover: read('--gold-soft', 'rgba(212,175,55,.3)'),
      line: read('--hex-line', '#888'),
      featureInk: read('--feature-ink', '#f4ecd8'),
      terrain,
    };
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  render(camera: Camera, doc: HexMap, hover: Axial | null): void {
    const ctx = this.ctx;
    if (!ctx || this.width === 0 || this.height === 0) return;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Void: a flat neutral fill across the whole surface (CONTEXT.md → Void).
    ctx.fillStyle = this.palette.void;
    ctx.fillRect(0, 0, this.width, this.height);

    const visible = hexesInRect(this.layout, this.visibleWorldRect(camera));

    // Painted terrain, under the grid lines. Only the visible painted hexes are
    // drawn — the document is sparse, so this never touches the infinite Void.
    // While here, note which hexes carry a feature so the marker pass below can
    // walk that short list instead of re-scanning every visible hex.
    const featured: { hex: Axial; ref: FeatureId }[] = [];
    for (const hex of visible) {
      const painted = doc.hexes[coordKey(hex)];
      if (!painted) continue;
      ctx.fillStyle = this.palette.terrain[painted.terrain];
      this.tracePath(ctx, camera, hex);
      ctx.fill();
      if (painted.feature) featured.push({ hex, ref: painted.feature.ref });
    }

    // Hover highlight next, so the grid lines draw crisply on top of it.
    if (hover) {
      ctx.fillStyle = this.palette.hover;
      this.tracePath(ctx, camera, hover);
      ctx.fill();
    }

    ctx.lineWidth = 1;
    ctx.strokeStyle = this.palette.line;
    for (const hex of visible) {
      this.tracePath(ctx, camera, hex);
      ctx.stroke();
    }

    // Feature markers ride on top of the grid (CONTEXT.md → Feature). The
    // join/cap/strokeStyle changes are wrapped in save/restore so they don't
    // leak into the next frame's grid stroke. The marker scale depends only on
    // the zoom, so it's computed once here rather than per feature.
    if (featured.length > 0) {
      const radius = this.layout.size.y * camera.zoom;
      const scale = (radius * MARKER_SCALE) / ICON_BOX;
      ctx.save();
      ctx.strokeStyle = this.palette.featureInk;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (const { hex, ref } of featured) {
        this.strokeMarker(ctx, camera, hex, ref, scale);
      }
      ctx.restore();
    }
  }

  /**
   * Stroke a feature's icon, centred on `hex`. The library art is authored in a
   * 24×24 box; this scales it to a fraction of the on-screen hex and keeps the
   * stroke a constant screen weight whatever the zoom.
   */
  private strokeMarker(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    hex: Axial,
    id: FeatureId,
    scale: number,
  ): void {
    const path = this.markerPath(id);
    if (!path) return;
    const centre = camera.worldToScreen(hexToPixel(this.layout, hex));
    ctx.save();
    ctx.translate(centre.x, centre.y);
    ctx.scale(scale, scale);
    ctx.translate(-ICON_BOX / 2, -ICON_BOX / 2); // centre the box on the hex
    ctx.lineWidth = MARKER_STROKE / scale; // undo the scale so it stays crisp
    ctx.stroke(path);
    ctx.restore();
  }

  /** The marker `Path2D` for a feature, built once and cached (or null if it can't be). */
  private markerPath(id: FeatureId): Path2D | null {
    if (typeof Path2D === 'undefined') return null;
    let path = this.markerPaths.get(id);
    if (!path) {
      const feature = FEATURE_BY_ID.get(id);
      if (!feature) return null;
      path = new Path2D(feature.path);
      this.markerPaths.set(id, path);
    }
    return path;
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
