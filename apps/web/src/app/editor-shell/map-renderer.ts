import {
  Axial,
  coordKey,
  FeatureId,
  featureLibrary,
  hexCorners,
  hexesInRect,
  Hex,
  hexToPixel,
  HexMap,
  HexWrite,
  Label,
  Layout,
  neighbors,
  parseCoordKey,
  Point,
  rectFromCorners,
  Region,
  terrainPalette,
  TerrainId,
} from '@hexly/domain';
import { Camera } from './camera';
import type { Selection } from './editor-store';

/** The built-in features keyed by id, for a marker's path lookup. */
const FEATURE_BY_ID = new Map(featureLibrary.map((f) => [f.id, f]));
/**
 * A region border's stroke weight in screen pixels, held constant across zoom.
 * Regions are drawn as coloured boundaries rather than surface tints, which
 * reads better and keeps the terrain legible where regions overlap (issue #8).
 */
const REGION_BORDER_WIDTH = 2.5;
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
 * The serif stack a Label is drawn in — a cartographic look that sets Labels
 * apart from the sans-serif UI chrome. Falls back through common serifs so it
 * renders without a bundled webfont (issue #10).
 */
const LABEL_FONT = 'Georgia, "Times New Roman", serif';
/**
 * A Hex name's font — a quiet sans-serif, deliberately set apart from the serif
 * a Label uses (ADR-0016). The name is structured metadata bound to the hex, not
 * cartographic typography, so it must never read as a second Label system.
 */
const NAME_FONT =
  'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
/** A Hex name's text height as a fraction of the on-screen hex radius — kept small. */
const NAME_SCALE = 0.34;
/**
 * How far below the hex centre a name sits when the hex carries a Feature, as a
 * fraction of the hex radius, so the name clears the marker rather than colliding
 * with it. A bare named hex draws its name on the centre instead (ADR-0016).
 */
const NAME_FEATURE_OFFSET = 0.78;
/**
 * The minimum clickable half-width (in screen px) every Label's hit-box gets,
 * tied to the font size. An empty or one-glyph label measures ~0 wide, which
 * would orphan it — invisible *and* unclickable — so it could never be
 * re-selected to give it text back. Flooring the box to the font px keeps such
 * a label grabbable (issue #2). Drawing is unchanged; only the box is widened.
 */
const MIN_LABEL_HALF_WIDTH_FACTOR = 1;
/** A selection highlight's stroke weight in screen pixels, constant across zoom. */
const SELECTION_STROKE = 3;
/**
 * The opacity a selected Region's member-hex fill is drawn at. Translucent so the
 * terrain (and the region's own border) stay legible beneath the tint, while
 * still making membership readable cell-by-cell during editing (ADR-0011).
 */
const SELECTION_FILL_ALPHA = 0.25;
/** The opacity a blocked-move cell is washed at, so the danger tint reads over the terrain beneath it (issue #64). */
const BLOCKED_FILL_ALPHA = 0.45;
/** Screen-pixel padding around a selected Label's text box, so the bounds clear the glyphs. */
const SELECTION_LABEL_PAD = 4;
/** A live marquee rectangle's stroke weight in screen pixels, constant across zoom. */
const MARQUEE_STROKE = 1.5;
/** The marquee's dash pattern (screen pixels on/off) — the one dashed stroke in the renderer. */
const MARQUEE_DASH: readonly number[] = [5, 4];

/**
 * The seam between the editor and whatever draws the map. There is one Canvas 2D
 * implementation today; the interface exists so a WebGL backend can drop in
 * later without touching the rest of the app (ADR-0003). A renderer owns its
 * drawing surface and paints one frame on demand for a given camera transform.
 */
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

/** A Label's axis-aligned screen-space box, recorded each frame for hit-testing. */
interface LabelBox {
  readonly id: string;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** The themed colours one frame needs, resolved from CSS custom properties. */
interface Palette {
  readonly void: string;
  readonly hover: string;
  readonly line: string;
  /** The ink a feature marker is stroked in, from `--feature-ink`. */
  readonly featureInk: string;
  /** The ink a Label's text is filled in, from `--label-ink`. */
  readonly labelInk: string;
  /** The ink a Hex name is filled in, from `--name-ink` (ADR-0016). */
  readonly nameInk: string;
  /** The accent a selection highlight is stroked in, from `--gold-strong`. */
  readonly selected: string;
  /** The danger ink a blocked move cell is washed in, from `--ember` (issue #64). */
  readonly blocked: string;
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
  /**
   * Each Label's screen-space box from the most recent frame, in draw order, so
   * {@link labelAt} can hit-test a click against what the user sees. Labels move
   * with the camera, so this is rebuilt every render rather than cached.
   */
  private labelBoxes: LabelBox[] = [];
  /**
   * For each hex edge (corner `i` → corner `i+1`), the {@link neighbors}
   * direction index of the hex across it. Lets the region pass tell a boundary
   * edge (neighbour outside the region) from an interior one. The mapping is
   * purely combinatorial — derived once in isotropic space — so it holds for
   * either orientation and any (possibly anisotropic) layout size.
   */
  private readonly edgeNeighborDir: readonly number[];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly layout: Layout,
  ) {
    this.ctx = canvas.getContext('2d');
    this.palette = this.readPalette();
    this.edgeNeighborDir = this.computeEdgeNeighborDirs();
  }

  /**
   * Match each hex edge to the neighbour sharing it: the edge's outward midpoint
   * direction agrees most closely with that neighbour's centre direction. The
   * mapping is derived in an *isotropic* unit layout (size 1×1, origin 0), so it
   * depends only on the orientation — never on the layout's size. That keeps the
   * dot-product a true bijection even for anisotropic hexes (size.x != size.y),
   * where matching in the real per-axis layout would break the topology.
   */
  private computeEdgeNeighborDirs(): number[] {
    const unit: Layout = {
      orientation: this.layout.orientation,
      size: { x: 1, y: 1 },
      origin: { x: 0, y: 0 },
    };
    const origin: Axial = { q: 0, r: 0 };
    const centre = hexToPixel(unit, origin);
    const corners = hexCorners(unit, origin);
    const ns = neighbors(origin);
    return corners.map((a, i) => {
      const b = corners[(i + 1) % 6];
      const mid = { x: (a.x + b.x) / 2 - centre.x, y: (a.y + b.y) / 2 - centre.y };
      let best = 0;
      let bestDot = -Infinity;
      ns.forEach((n, d) => {
        const nc = hexToPixel(unit, n);
        const dot = mid.x * (nc.x - centre.x) + mid.y * (nc.y - centre.y);
        if (dot > bestDot) {
          bestDot = dot;
          best = d;
        }
      });
      return best;
    });
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
      labelInk: read('--label-ink', '#f4ecd8'),
      nameInk: read('--name-ink', '#f4ecd8'),
      selected: read('--gold-strong', '#7e560f'),
      blocked: read('--ember', '#a4402e'),
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

  render(
    camera: Camera,
    doc: HexMap,
    hover: Axial | null,
    overrides: RenderOverrides = {},
  ): void {
    const {
      labelPositions = null,
      selections = [],
      movePreview = null,
      marquee = null,
      blockedCells = [],
      regionPreview = null,
    } = overrides;
    const ctx = this.ctx;
    if (!ctx || this.width === 0 || this.height === 0) return;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // Void: a flat neutral fill across the whole surface (CONTEXT.md → Void).
    ctx.fillStyle = this.palette.void;
    ctx.fillRect(0, 0, this.width, this.height);

    const visible = hexesInRect(this.layout, this.visibleWorldRect(camera));
    // The visible hexes keyed for membership lookups — shared by the region
    // border pass and the selected-region fill so neither walks off-screen cells
    // and the Set is built once per frame.
    const visibleKeys = new Set(visible.map(coordKey));

    // A live move previews without touching the document by overlaying the planner's
    // resolved writes: a `{ coord, hex }` draws that record at `coord` and a `{ coord,
    // hex: null }` leaves it Void. This carries both a single-hex swap (the dragged
    // record at the destination, the occupant slid back to the origin) and a whole
    // group translated to its destinations with the vacated origins cleared
    // (ADR-0017, issues #30, #64). Built once into a key→record map; an undefined
    // lookup means "not previewed here — draw as stored".
    const preview = new Map<string, Hex | null>();
    if (movePreview) {
      for (const { coord, hex } of movePreview) preview.set(coordKey(coord), hex);
    }

    // Painted terrain, under the grid lines. Only the visible painted hexes are
    // drawn — the document is sparse, so this never touches the infinite Void.
    // While here, note which hexes carry a feature so the marker pass below can
    // walk that short list instead of re-scanning every visible hex.
    const featured: { hex: Axial; ref: FeatureId }[] = [];
    // The named hexes, noting whether each also carries a feature so the name pass
    // can anchor the text below the marker (or on the centre for a bare hex).
    const named: { hex: Axial; name: string; hasFeature: boolean }[] = [];
    for (const hex of visible) {
      const key = coordKey(hex);
      // A previewed cell draws its overlaid record (or Void when the write clears it);
      // every other cell draws as stored.
      const painted = preview.has(key) ? preview.get(key) : doc.hexes[key];
      if (!painted) continue;
      ctx.fillStyle = this.palette.terrain[painted.terrain];
      this.tracePath(ctx, camera, hex);
      ctx.fill();
      if (painted.feature) featured.push({ hex, ref: painted.feature.ref });
      // An absent or empty name draws nothing (ADR-0016).
      if (painted.name) named.push({ hex, name: painted.name, hasFeature: !!painted.feature });
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

    // Region borders ride above the grid: each region strokes only its boundary
    // edges (those whose neighbour is outside the region) in its own colour, so
    // it reads as a coloured outline and overlapping regions stay legible
    // (issue #8). Interior edges between two members are skipped. Each boundary
    // edge is its own single-segment subpath, so lineJoin never fires; lineCap
    // 'round' is what rounds the butt ends and fills the notches at corners.
    // Work is proportional to region membership, not the viewport: we intersect
    // each region's own members with the visible set rather than re-scanning
    // every visible hex per region.
    if (doc.regions.length > 0) {
      ctx.save();
      ctx.lineWidth = REGION_BORDER_WIDTH;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (const region of doc.regions) {
        ctx.strokeStyle = region.color;
        // A dragged region previews its translated footprint; others draw as stored.
        const members = regionPreview?.get(region.id) ?? region.hexes;
        for (const key of Object.keys(members)) {
          if (!visibleKeys.has(key)) continue;
          this.strokeRegionBorder(ctx, camera, parseCoordKey(key), members);
        }
      }
      ctx.restore();
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

    // Hex names ride above their content: small text bound to the coordinate,
    // always visible — not only when selected (ADR-0016). Drawn after the markers
    // so a named feature's name sits below its icon, and before Labels so free
    // typography stays on top. The font/baseline are set once for the whole pass.
    if (named.length > 0) {
      const radius = this.layout.size.y * camera.zoom;
      ctx.save();
      ctx.fillStyle = this.palette.nameInk;
      ctx.font = `${radius * NAME_SCALE}px ${NAME_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const { hex, name, hasFeature } of named) {
        this.drawHexName(ctx, camera, hex, name, hasFeature ? radius * NAME_FEATURE_OFFSET : 0);
      }
      ctx.restore();
    }

    // Labels ride on top of everything: free-positioned cartographic text, not
    // snapped to the grid (CONTEXT.md → Label, issue #10). Each frame records the
    // text's screen box so `labelAt` can hit-test clicks for select/drag. The
    // box is rebuilt here (not cached) because labels move with the camera.
    this.labelBoxes = [];
    if (doc.labels.length > 0) {
      ctx.save();
      ctx.fillStyle = this.palette.labelInk;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const label of doc.labels) {
        // Preview any dragged label at its live position without cloning the doc.
        const position = labelPositions?.get(label.id) ?? label.position;
        this.drawLabel(ctx, camera, label, position);
      }
      ctx.restore();
    }

    // Blocked-move cells ride above the content but below the selection accent: a
    // live group move whose plan is refused washes each contested destination in the
    // danger ink, so the drag reads as blocked before release (ADR-0017, issue #64).
    // A preview overlay only — the document is never mutated to draw it.
    if (blockedCells.length > 0) {
      ctx.save();
      ctx.globalAlpha = BLOCKED_FILL_ALPHA;
      ctx.fillStyle = this.palette.blocked;
      for (const cell of blockedCells) {
        this.tracePath(ctx, camera, cell);
        ctx.fill();
      }
      ctx.restore();
    }

    // The selection highlight rides on top of everything (issue #28): every member
    // of the Selection set is highlighted (ADR-0017) — a Hex or Feature gets a
    // strong outline on its hex, a Label a bounds rectangle around the box
    // `drawLabel` just recorded, a Region a translucent member-fill. Drawn last so
    // it sits above the grid, markers, and label text it points at. A live drag
    // makes its highlight follow the previewed content because the canvas hands this
    // pass the selection already translated to the destinations (issues #30, #64) —
    // so the renderer draws each member where it is told, no drag-tracking here.
    //
    // The selection pass is O(selected) per frame, not O(selected × total): two
    // id→entity indexes are built once here so each selected member resolves its
    // Label box and Region by lookup rather than re-scanning `labelBoxes` /
    // `doc.regions`. Both preserve first-wins (matching the old `.find`).
    const labelBoxById = new Map<string, LabelBox>();
    for (const box of this.labelBoxes) {
      if (!labelBoxById.has(box.id)) labelBoxById.set(box.id, box);
    }
    const regionById_ = new Map<string, Region>();
    for (const region of doc.regions) {
      if (regionById_.has(region.id)) continue;
      // The selection tint follows a dragged region's previewed footprint too, so
      // the highlight rides with the border above it.
      const previewFootprint = regionPreview?.get(region.id);
      regionById_.set(
        region.id,
        previewFootprint ? { ...region, hexes: previewFootprint } : region,
      );
    }
    for (const selection of selections) {
      this.drawSelection(
        ctx,
        camera,
        regionById_,
        labelBoxById,
        visibleKeys,
        selection,
      );
    }

    // The live marquee rectangle rides on top of everything: a dashed accent
    // outline of the box being dragged (ADR-0017), previewed straight from its
    // world corners without touching the document.
    if (marquee) this.drawMarquee(ctx, camera, marquee);
  }

  /**
   * Stroke the live marquee box as a dashed accent rectangle. The two world
   * corners project to screen via the camera (a scale+translate, so an
   * axis-aligned world box stays axis-aligned on screen) and are normalised to
   * min/max so the outline is correct whichever way the drag runs. The dash and
   * stroke settings are wrapped in save/restore so they never leak into the next
   * frame's grid stroke.
   */
  private drawMarquee(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    marquee: MarqueeOverride,
  ): void {
    // Project both world corners to screen, then normalise via the shared
    // two-corner→Rect helper so the outline matches the canvas's hit-test box
    // exactly (one definition of "rect from two corners", in the domain).
    const { minX, minY, maxX, maxY } = rectFromCorners(
      camera.worldToScreen(marquee.a),
      camera.worldToScreen(marquee.b),
    );
    ctx.save();
    ctx.strokeStyle = this.palette.selected;
    ctx.lineWidth = MARQUEE_STROKE;
    ctx.lineJoin = 'round';
    ctx.setLineDash([...MARQUEE_DASH]);
    ctx.beginPath();
    ctx.moveTo(minX, minY);
    ctx.lineTo(maxX, minY);
    ctx.lineTo(maxX, maxY);
    ctx.lineTo(minX, maxY);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  labelAt(point: Point): string | null {
    // Topmost (last drawn) wins, so iterate the recorded boxes in reverse.
    for (let i = this.labelBoxes.length - 1; i >= 0; i--) {
      const box = this.labelBoxes[i];
      if (
        point.x >= box.minX &&
        point.x <= box.maxX &&
        point.y >= box.minY &&
        point.y <= box.maxY
      ) {
        return box.id;
      }
    }
    return null;
  }

  /**
   * Draw the selection highlight in the accent ink: an outline tracing the
   * selected Hex/Feature's hex, or a padded bounds rectangle around the selected
   * Label's most-recently-recorded box. A label whose box is absent (off-screen,
   * or no labels drawn) highlights nothing. Wrapped in save/restore so the stroke
   * settings never leak into the next frame.
   */
  private drawSelection(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    regionById: ReadonlyMap<string, Region>,
    labelBoxById: ReadonlyMap<string, LabelBox>,
    visibleKeys: Set<string>,
    selection: Selection,
  ): void {
    // A Region is highlighted by tinting its member hexes, not by an accent
    // outline — its boundary stroke already comes from the regions pass (#35).
    if (selection.kind === 'region') {
      this.fillRegionMembers(ctx, camera, regionById, visibleKeys, selection.id);
      return;
    }
    ctx.save();
    ctx.strokeStyle = this.palette.selected;
    ctx.lineWidth = SELECTION_STROKE;
    ctx.lineJoin = 'round';
    if (selection.kind === 'label') {
      const box = labelBoxById.get(selection.id);
      // Trace the padded box as a closed path and stroke it (rather than
      // `strokeRect`) so it draws like every other outline — one stroke pass.
      if (box) {
        const p = SELECTION_LABEL_PAD;
        ctx.beginPath();
        ctx.moveTo(box.minX - p, box.minY - p);
        ctx.lineTo(box.maxX + p, box.minY - p);
        ctx.lineTo(box.maxX + p, box.maxY + p);
        ctx.lineTo(box.minX - p, box.maxY + p);
        ctx.closePath();
        ctx.stroke();
      }
    } else {
      this.tracePath(ctx, camera, selection.coord);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Highlight the selected Region by tinting each of its member hexes with a
   * translucent fill in the region's own colour. The boundary stroke is left to
   * the regions pass (which strokes every region); this only adds the interior
   * wash, so an unselected region stays border-only (ADR-0011, issue #35). A
   * region that no longer exists (deleted between resolve and draw) tints nothing.
   * Off-screen members are skipped via `visibleKeys`, so the work is proportional
   * to the visible membership — matching the region border pass, not the region's
   * total size.
   */
  private fillRegionMembers(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    regionById: ReadonlyMap<string, Region>,
    visibleKeys: Set<string>,
    id: string,
  ): void {
    const region = regionById.get(id);
    if (!region) return;
    ctx.save();
    ctx.globalAlpha = SELECTION_FILL_ALPHA;
    ctx.fillStyle = region.color;
    for (const key of Object.keys(region.hexes)) {
      if (!visibleKeys.has(key)) continue;
      this.tracePath(ctx, camera, parseCoordKey(key));
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * Draw one Label's text centred on the given world `position` (which may be a
   * live drag override, not the stored `label.position`), scaled so `size` is a
   * world measure (it zooms with the map) and rotated by its optional `rotation`.
   * Records an axis-aligned screen box for hit-testing; the box ignores rotation
   * (a close-enough bound that keeps click-to-select cheap and predictable).
   */
  private drawLabel(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    label: Label,
    position: Point,
  ): void {
    const centre = camera.worldToScreen(position);
    const fontPx = label.size * camera.zoom;
    ctx.save();
    ctx.translate(centre.x, centre.y);
    if (label.rotation) ctx.rotate((label.rotation * Math.PI) / 180);
    ctx.font = `${fontPx}px ${LABEL_FONT}`;
    const width = ctx.measureText(label.text).width;
    ctx.fillText(label.text, 0, 0);
    ctx.restore();

    // Floor the hit-box width so an empty/short label stays clickable (issue #2).
    const halfW = Math.max(width, fontPx * MIN_LABEL_HALF_WIDTH_FACTOR) / 2;
    const halfH = fontPx / 2;
    this.labelBoxes.push({
      id: label.id,
      minX: centre.x - halfW,
      maxX: centre.x + halfW,
      minY: centre.y - halfH,
      maxY: centre.y + halfH,
    });
  }

  /**
   * Draw a Hex's `name` anchored to `hex`, dropped `offsetY` screen pixels below
   * the centre (so it clears a feature marker, or sits on the centre when there is
   * none). The font, fill, and alignment are set by the caller's pass (ADR-0016).
   */
  private drawHexName(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    hex: Axial,
    name: string,
    offsetY: number,
  ): void {
    const centre = camera.worldToScreen(hexToPixel(this.layout, hex));
    ctx.fillText(name, centre.x, centre.y + offsetY);
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

  /**
   * Stroke the boundary edges of one region member hex: each edge whose
   * neighbour across it is *not* in `members` is part of the region's outline,
   * so it is drawn; shared edges between two members are skipped. Uses the
   * current strokeStyle/lineWidth set by the caller.
   */
  private strokeRegionBorder(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    hex: Axial,
    members: Record<string, true>,
  ): void {
    const corners = this.screenCorners(camera, hex);
    const ns = neighbors(hex);
    for (let i = 0; i < 6; i++) {
      if (members[coordKey(ns[this.edgeNeighborDir[i]])]) continue; // interior edge
      const a = corners[i];
      const b = corners[(i + 1) % 6];
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }

  /** The six hex corners in screen space, under the current camera. */
  private screenCorners(camera: Camera, hex: Axial): Point[] {
    return hexCorners(this.layout, hex).map((c) => camera.worldToScreen(c));
  }

  /** Lay down the screen-space polygon path for one hex (no fill/stroke). */
  private tracePath(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    hex: Axial,
  ): void {
    const corners = this.screenCorners(camera, hex);
    ctx.beginPath();
    corners.forEach((p, i) =>
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y),
    );
    ctx.closePath();
  }
}
