import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  HostListener,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import {
  addAxial,
  Axial,
  coordKey,
  hexToPixel,
  HexWrite,
  Layout,
  marqueeHits,
  pixelToHex,
  Point,
  rectFromCorners,
  regionById,
} from '@hexly/domain';
import { ThemeService } from '../../../core/services/theme.service';
import { ToasterService } from '../../../core/services/toaster.service';
import { terrainKey } from '../utils/catalog-keys';
import { HexMapStore, SelectMode, ToolId } from '../services/hexmap-store';
import { CoordReadout } from './coord-readout';
import { ZoomControl } from './zoom-control';
import { Camera } from '../utils/camera';
import { Canvas2dMapRenderer } from '../services/map-renderer';
import { MapRenderer, MarqueeOverride } from '../models/map-renderer';

/** Hex radius (centre→corner) in world pixels at zoom 1. */
const HEX_SIZE = 40;
/** Clamp the zoom so the cull never has to draw an unbounded hex count. */
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
/** Multiplier applied per zoom-button press. */
const ZOOM_STEP = 1.15;
/**
 * Wheel-zoom sensitivity: the factor is `e^(-Δy · k)`, so zooming scales with
 * how far the wheel moved rather than a fixed step per event. Touchpad and mouse
 * get separate knobs — a trackpad pinch emits a stream of tiny deltas, so it
 * needs a higher `k` than a mouse's chunky per-notch deltas to feel as fast.
 */
const ZOOM_SENSITIVITY_TOUCHPAD = 0.006;
const ZOOM_SENSITIVITY_MOUSE = 0.002;
/** Above this per-event |deltaY| (px), a wheel looks like a coarse mouse notch. */
const MOUSE_NOTCH_THRESHOLD = 40;
/** Pixels assumed per line, to normalise non-pixel wheel deltas. */
const LINE_HEIGHT = 16;
/** The placeholder text a freshly-dropped Label carries until it is edited. */
const NEW_LABEL_TEXT = 'Label';
/**
 * Screen-pixel travel a press must exceed before it counts as a drag rather than
 * a click (issue #30). Under the threshold a release is a plain selection; past
 * it, a whole-Hex move begins with a live preview, committed once on release.
 */
const HEX_DRAG_THRESHOLD = 4;

/**
 * The letter that arms each top-level Tool from the keyboard (issue #27). Region has
 * no key (ADR-0012): regions are created in the Regions panel and painted via the
 * Inspector's Add/Remove brush.
 */
const TOOL_HOTKEYS: Readonly<Record<string, ToolId>> = {
  s: 'select',
  t: 'terrain',
  f: 'feature',
  l: 'label',
  e: 'erase',
};

/**
 * The live map surface: an infinite, pannable, zoomable hex plane on a Canvas
 * (ADR-0003). The component owns interaction state — the {@link Camera}
 * transform and the hovered hex — and delegates all drawing to a
 * {@link MapRenderer} behind its interface. Most of the plane is Void, so this
 * draws the grid and proves the coordinate system, not painted content yet.
 */
@Component({
  selector: 'app-map-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CoordReadout, ZoomControl, TranslocoPipe],
  template: `
    <canvas
      #canvas
      class="absolute inset-0 w-full h-full block touch-none"
      role="img"
      [attr.aria-label]="'editorShell.hexMap' | transloco"
      [class.cursor-grab]="!dragging()"
      [class.cursor-grabbing]="dragging()"
      (pointerdown)="onPointerDown($event)"
      (pointermove)="onPointerMove($event)"
      (pointerup)="onPointerUp($event)"
      (pointercancel)="onPointerCancel($event)"
      (pointerleave)="onPointerLeave($event)"
      (wheel)="onWheel($event)"
    ></canvas>

    <!-- Vellum field layers over the transparent canvas: paper grain + edge
         vignette. Inert to the pointer (DOM order keeps them below the overlays). -->
    <div class="field-grain" aria-hidden="true"></div>
    <div class="field-vignette" aria-hidden="true"></div>

    <!-- Hover-coordinate readout, bottom-left. -->
    <app-coord-readout
      class="absolute bottom-4 left-4"
      [coord]="hover()"
      [terrainKey]="readoutKey()"
    />

    <!-- Zoom/fit controls, bottom-right. -->
    <app-zoom-control
      class="absolute right-4 bottom-4"
      [percent]="zoomPercent()"
      (zoomIn)="zoomByStep(1)"
      (zoomOut)="zoomByStep(-1)"
      (fit)="recenter()"
    />
  `,
  styles: `
    /*
      No position of its own — the shell positions it full-bleed (ADR-0013), and
      omitting it lets the shell's inline 'absolute inset-0' win over an (unlayered)
      :host rule. Paints the Vellum wash (top glow over a paper gradient) behind the
      transparent-Void canvas; 'isolation' confines the grain blend to the map and
      makes the host the containing block for the overlays below.
    */
    :host {
      overflow: hidden;
      isolation: isolate;
      background:
        radial-gradient(
          110% 85% at 50% -6%,
          var(--color-canvas-glow),
          transparent 60%
        ),
        linear-gradient(
          165deg,
          var(--color-canvas-bg),
          var(--color-canvas-mat)
        );
    }
    /*
      Paper tooth: a tiling desaturated SVG fractal-noise, blended low so it adds
      grain without shifting colour. Themed blend (multiply on light, screen on
      dark). No z-index — DOM order keeps it below readout/zoom.
    */
    .field-grain {
      position: absolute;
      inset: 0;
      pointer-events: none;
      opacity: 0.06;
      mix-blend-mode: multiply;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
      background-size: 180px 180px;
    }
    :host-context([data-theme='dark']) .field-grain {
      opacity: 0.05;
      mix-blend-mode: screen;
    }
    /* Soft edge vignette: clear centre, sinking to the themed edge ink at the corners. */
    .field-vignette {
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: radial-gradient(
        120% 90% at 50% 42%,
        transparent 56%,
        var(--color-canvas-edge) 100%
      );
    }
  `,
})
export class MapCanvas {
  private readonly canvasRef =
    viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  /** Per-map orientation; pointy-top by default (ADR-0003). Origin is world 0. */
  private readonly layout: Layout = {
    orientation: 'pointy',
    size: { x: HEX_SIZE, y: HEX_SIZE },
    origin: { x: 0, y: 0 },
  };

  /** The viewport transform — the single source of truth for pan and zoom. */
  protected readonly camera = signal(Camera.initial());
  /** The hex currently under the cursor, or null when the cursor is outside. */
  protected readonly hover = signal<Axial | null>(null);
  protected readonly dragging = signal(false);

  protected readonly zoomPercent = computed(() =>
    Math.round(this.camera().zoom * 100),
  );

  /**
   * The live Selection drag, once a press has crossed {@link HEX_DRAG_THRESHOLD}:
   * the `offset` (axial hex steps) and `labelDelta` (world pixels) the whole set
   * would move by. `null` when no drag is active. A hex/region selection snaps the
   * offset to hex steps (labels ride by the pixel-equivalent); a labels-only
   * selection moves by free pixels (`offset` stays zero). The renderer previews the
   * move from this; the store only sees the final {@link HexMapStore.moveSelection}
   * on release, so the whole drag is a single undo step (issues #30, #64).
   */
  private readonly drag = signal<{
    readonly offset: Axial;
    readonly labelDelta: Point;
  } | null>(null);

  /**
   * The in-progress marquee box-selection (Select's Marquee Subtool, ADR-0017):
   * the drag origin `a` and the cursor `b` in world space, plus whether the drag
   * is `additive` (Shift/Cmd held — accumulate into the set rather than replace).
   * `null` until a press starts under select+marquee. The renderer previews the
   * live rectangle from `a`/`b`; on release the box is run through the pure
   * {@link marqueeHits} helper and folded into the selection. World-space so the
   * box tracks the content under pan/zoom mid-drag, like the other overrides.
   */
  private readonly marquee = signal<{
    readonly a: Point;
    readonly b: Point;
    readonly additive: boolean;
  } | null>(null);

  /**
   * A press that *may* become a Selection drag, recorded on a plain pointer-down
   * over a selectable thing (issues #30, #64):
   * - `worldStart` / `hexStart` — the press point in world pixels and its hex, the
   *   anchors the live offset is measured from (pixels for a labels-only drag, hex
   *   steps for a hex/region drag).
   * - `labelHit` — the label id under the press, if any, so a plain release can
   *   re-pick it.
   * - `snapped` — whether the Selection holds a hex or region, so the drag snaps to
   *   hex steps; a labels-only selection drags by free pixels instead.
   * - `group` — the press landed on something already selected, so the whole set is
   *   preserved and a drag moves it all; a plain release collapses to what was
   *   clicked. `false` for a press that just selected one fresh entity.
   *
   * Stays a plain field (not a signal) — it gates the move gesture but never the
   * render. `null` when no such press is armed.
   */
  private dragPress:
    | {
        worldStart: Point;
        hexStart: Axial;
        labelHit: string | null;
        clientX: number;
        clientY: number;
        snapped: boolean;
        group: boolean;
      }
    | null = null;

  /**
   * An in-progress modifier select-sweep (ADR-0017): holding Cmd/Ctrl (`add-top`)
   * or Shift (`add-stack`) and dragging adds each hex the pointer enters to the
   * Selection set. `last` is the coordKey most recently folded in, so a hex is
   * added once per sweep and re-entering it doesn't churn. `null` when no sweep is
   * active. Selection is transient view state, so a sweep records no undo step;
   * unlike a label/hex move it commits live as it goes rather than on release.
   */
  private selectSweep: { mode: SelectMode; last: string } | null = null;

  /**
   * The `pointerId` that owns the canvas for one gesture (claimed on down,
   * released on up/cancel), or `null` between gestures. Other pointers are
   * ignored while it's held — see {@link foreignPointer}.
   */
  private activePointerId: number | null = null;

  /**
   * The mouse `button` that claimed the gesture (0 primary, 1 middle), or `null`.
   * A mouse reuses one `pointerId` across buttons, so pointerId alone can't tell a
   * stray right/middle release from the owning one — onPointerUp checks this too.
   */
  private gestureButton: number | null = null;

  private readonly theme = inject(ThemeService);
  private readonly store = inject(HexMapStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);

  /**
   * The translation key for the hover readout: the painted hex's built-in terrain
   * keyed by id (`domain.terrain.<id>`, ADR-0014) when one is under the cursor, the
   * "Void" key when the hovered coordinate is unpainted, or the "no hex" key when
   * the pointer is off the canvas entirely. The terrain id is schema-constrained
   * to the built-ins, so the key always resolves.
   */
  protected readonly readoutKey = computed(() => {
    const hex = this.hover();
    if (!hex) return 'editorShell.canvas.noHex';
    const painted = this.store.document().hexes[coordKey(hex)];
    if (!painted) return 'editorShell.canvas.void';
    return terrainKey(painted.terrain);
  });

  private renderer: MapRenderer | null = null;
  private centred = false;
  private lastPointer: { x: number; y: number } | null = null;
  /** True while a primary-button paint/erase stroke is in progress. */
  private painting = false;
  /** True while a middle-button pan drag is in progress. */
  private panning = false;
  /** The last hex the active stroke touched, so a drag paints each hex once. */
  private lastStroke: string | null = null;

  constructor() {
    // Repaint whenever pan, zoom, the painted document, a label drag, or the
    // selection changes. Reading the signals inside renderFrame() registers them
    // as dependencies; the label-drag override previews the dragged label without
    // cloning the document each frame.
    effect(() => this.renderFrame());

    // Re-read the renderer's themed colours and repaint when the theme switches.
    // The renderer caches the palette, so this is the only place it pays for a
    // style read — the per-frame render path stays free of `getComputedStyle`.
    // The render inputs are read untracked so only an actual theme switch (not a
    // pan/paint/selection change) drives this costlier path.
    effect(() => {
      this.theme.theme();
      if (!this.renderer) return;
      this.renderer.refreshTheme();
      untracked(() => this.renderFrame());
    });

    afterNextRender(() => {
      const canvas = this.canvasRef()?.nativeElement;
      if (!canvas) return;
      this.renderer = new Canvas2dMapRenderer(canvas, this.layout);
      this.observeSize(canvas);
    });
  }

  /**
   * Paint one frame from the current signal values — the single render call site.
   * Read every signal into a local *before* the null-guarded `render` call: under
   * `this.renderer?.render(...)` the optional chaining would skip evaluating the
   * arguments while the renderer is still null (the effect's first run, before
   * `afterNextRender`), so the signals would go untracked and the effect would
   * never repaint again.
   */
  private renderFrame(): void {
    const camera = this.camera();
    const doc = this.store.document();
    const hover = this.hover();
    const drag = this.drag();
    // While a marquee is dragging, highlight the elements it currently encloses —
    // a *live* preview of what releasing it would select, resolved by the store
    // against the document (so a featured cell reads as a Feature, exactly as the
    // commit will). The committed set is read unconditionally so this effect still
    // repaints on a normal selection change; the marquee path then overrides it.
    const marqueeState = this.marquee();
    let selections = this.store.selections();
    let marquee: MarqueeOverride | null = null;
    let movePreview: readonly HexWrite[] | null = null;
    let blockedCells: readonly Axial[] = [];
    let labelPositions: ReadonlyMap<string, Point> | null = null;
    let regionPreview: ReadonlyMap<string, Record<string, true>> | null = null;
    if (marqueeState) {
      marquee = { a: marqueeState.a, b: marqueeState.b };
      const rect = rectFromCorners(marqueeState.a, marqueeState.b);
      const hits = marqueeHits(this.layout, doc, rect);
      selections = this.store.marqueePreview(
        hits.hexes,
        hits.labels,
        marqueeState.additive,
      );
    } else if (drag) {
      // A live Selection drag previews exactly what releasing it would commit, from
      // the one shared query the store also commits from (issues #30, #64): a
      // resolved plan overlays its hex writes (the group at its destinations),
      // draws every selected label at its previewed position, and the highlight
      // follows by translating each selected cell; a blocked plan washes the
      // contested cells red and leaves the group in place, since releasing it would
      // be a no-op that snaps back.
      const { plan, labelPositions: previewLabels } = this.store.previewSelectionMove(
        drag.offset,
        drag.labelDelta,
      );
      if (plan.blocked) {
        blockedCells = plan.cells;
      } else {
        movePreview = plan.hexes;
        const { offset } = drag;
        selections = selections.map((s) =>
          s.kind === 'hex' || s.kind === 'feature'
            ? { ...s, coord: addAxial(s.coord, offset) }
            : s,
        );
        labelPositions = previewLabels;
        // The selected regions' translated footprints (from the same plan) preview
        // their border and tint at the destination; an empty plan yields an empty
        // map the renderer treats as "no override", so no guard is needed.
        regionPreview = new Map(plan.regions.map((r) => [r.id, r.hexes]));
      }
    }
    this.renderer?.render(camera, doc, hover, {
      labelPositions,
      selections,
      movePreview,
      marquee,
      blockedCells,
      regionPreview,
    });
  }

  protected onPointerDown(event: PointerEvent): void {
    if (this.foreignPointer(event)) return;
    const hex = pixelToHex(this.layout, this.toWorld(event));
    this.hover.set(hex);

    // Middle button pans; the primary button paints/erases the armed tool. Pan
    // also stays on the wheel, so a mouse-only user is never stuck (ADR-0003).
    if (event.button === 1) {
      // A pan supersedes any armed/live Select drag (e.g. a held left button over
      // a selected hex), so the gesture pans instead of getting stuck re-targeting
      // a move under the pointer-move drag branch.
      this.dragPress = null;
      this.drag.set(null);
      // A live select-sweep also yields to the pan: onPointerMove checks the sweep
      // branch before the pan branch, so a sweep left armed here would swallow the
      // pan moves. A live marquee likewise yields, committing nothing.
      this.selectSweep = null;
      this.marquee.set(null);
      this.claimGesture(event);
      this.panning = true;
      this.dragging.set(true);
      this.lastPointer = { x: event.clientX, y: event.clientY };
      return;
    }

    // Only the primary button paints. Right/aux buttons must not lay down a hex
    // (and steal the right-click context menu along the way) — and they neither
    // claim the gesture nor capture the pointer, so a right-click never blocks a
    // real drag nor strands a captured-but-unowned pointer.
    if (event.button !== 0) return;
    this.claimGesture(event);

    const world = this.toWorld(event);

    // Select is the only selection path (ADR-0010): it selects the topmost entity
    // under the cursor and, for a Label, starts a drag. Painting Tools no longer
    // select — a Label is inert to them — so this is gated to Select; under a
    // painting Tool the same click falls through and paints the hex beneath the
    // label. Precedence (Label → Feature → Hex, clear on empty) lives in the
    // store: the canvas only supplies the geometric inputs — the hex under the
    // pointer and the label hit — and hands them over (issue #28).
    if (this.store.tool() === 'select') {
      // The Marquee Subtool drags a box anywhere — including over painted hexes,
      // where there is no empty space for a pick-drag to begin (ADR-0017). Start
      // the live rectangle at the press point; the pick logic below is skipped.
      // Shift/Cmd makes it additive (accumulate boxes); a plain box replaces.
      if (this.store.selectSubtool() === 'marquee') {
        this.marquee.set({
          a: world,
          b: world,
          additive: event.shiftKey || event.metaKey || event.ctrlKey,
        });
        return;
      }
      const hitId = this.renderer?.labelAt(this.localPoint(event)) ?? null;
      const modifier = event.shiftKey || event.metaKey || event.ctrlKey;
      // A plain press on something *already* selected — a hex, a label, or a coord
      // that belongs to a selected region — drags the whole Selection (issue #64):
      // preserve the set and arm a group drag rather than re-selecting. The collapse
      // to the pressed entity is deferred to a plain release (no drag) below, so
      // click-to-pick still works. A modifier press always folds into the set instead.
      if (!modifier && this.pressOnSelection(hex, hitId)) {
        this.dragPress = {
          worldStart: world,
          hexStart: hex,
          labelHit: hitId,
          clientX: event.clientX,
          clientY: event.clientY,
          snapped: this.selectionHasHexOrRegion(),
          group: true,
        };
        return;
      }
      // Modifiers fold the click into the Selection set (ADR-0017): Shift toggles
      // the whole stack at the coordinate, Cmd/Ctrl the topmost entity; a plain
      // click replaces (and cycles). Cmd/Ctrl wins if both are somehow held.
      const mode: SelectMode = event.shiftKey
        ? 'toggle-stack'
        : event.metaKey || event.ctrlKey
          ? 'toggle-top'
          : 'replace';
      const before = this.store.selections().length;
      const selection = this.store.select(hex, hitId, mode);
      const grew = this.store.selections().length > before;
      // A modifier-held press becomes a select-sweep instead of a move: the click
      // already folded this hex in, and dragging now *adds* each further hex via
      // the add-only counterpart (so the sweep never toggles a hex back off).
      // Moving the selected set itself is out of scope for now (ADR-0017). Only
      // arm the sweep when the press *grew* the set: a modifier press that toggled
      // an entity off (Cmd-click a selected hex, Shift-click a full stack) or hit
      // empty Void must not start a drag that re-adds or mass-selects from nothing.
      if (mode !== 'replace') {
        if (grew) {
          this.selectSweep = {
            mode: mode === 'toggle-stack' ? 'add-stack' : 'add-top',
            last: coordKey(hex),
          };
        }
        return;
      }
      // A plain click selected one entity (or cleared on empty Void). When something
      // was selected, arm a *potential* drag of it: crossing the threshold in
      // {@link onPointerMove} turns it into a {@link HexMapStore.moveSelection}; a
      // release before the threshold stays a plain click. A Label drags by free
      // pixels (`snapped` false, so it follows the cursor exactly); a Hex, Feature,
      // or Region snaps to hex steps.
      if (selection) {
        this.dragPress = {
          worldStart: world,
          hexStart: hex,
          labelHit: hitId,
          clientX: event.clientX,
          clientY: event.clientY,
          snapped: selection.kind !== 'label',
          group: false,
        };
      }
      return;
    }

    // The label tool drops a new, selected label at the clicked world point.
    if (this.store.tool() === 'label') {
      this.store.selectLabel(this.store.addLabel(NEW_LABEL_TEXT, world));
      return;
    }

    this.painting = true;
    this.lastStroke = null;
    this.strokeAt(hex);
  }

  protected onPointerMove(event: PointerEvent): void {
    if (this.foreignPointer(event)) return;
    const hex = pixelToHex(this.layout, this.toWorld(event));
    this.hover.set(hex);

    // A live marquee drag re-targets its far corner to the cursor each move and
    // re-reads the modifier (so toggling Shift/Cmd mid-drag flips additive). The
    // renderer previews the rectangle there; the selection only changes on release.
    const marquee = this.marquee();
    if (marquee) {
      this.marquee.set({
        a: marquee.a,
        b: this.toWorld(event),
        additive: event.shiftKey || event.metaKey || event.ctrlKey,
      });
      return;
    }

    // A modifier select-sweep folds each newly-entered hex into the set as the
    // pointer passes over it (ADR-0017). Add it once per hex — re-entering the
    // last one does nothing — via the same add-only path the store exposes.
    const sweep = this.selectSweep;
    if (sweep) {
      // Read the modifier live: releasing Cmd/Ctrl/Shift mid-drag ends the sweep
      // so it stops adding more (the entities already swept in stay selected),
      // rather than keeping the frozen press-time mode going.
      const stillHeld = event.shiftKey || event.metaKey || event.ctrlKey;
      if (!stillHeld) {
        this.selectSweep = null;
        return;
      }
      const key = coordKey(hex);
      if (key !== sweep.last) {
        sweep.last = key;
        const hitId = this.renderer?.labelAt(this.localPoint(event)) ?? null;
        this.store.select(hex, hitId, sweep.mode);
      }
      return;
    }

    // An armed press becomes a Selection drag once the pointer travels past the
    // threshold; thereafter every move recomputes the offset the whole set would
    // move by, and the render effect previews it there until release (issues #30,
    // #64). A hex/region selection snaps to the destination hex under the cursor
    // (labels riding by the pixel-equivalent); a labels-only selection tracks the
    // raw pixel delta from the press, so the grabbed label follows the cursor exactly.
    const press = this.dragPress;
    if (press) {
      const moved =
        Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY) >=
        HEX_DRAG_THRESHOLD;
      if (this.drag() || moved) {
        if (press.snapped) {
          const a = hexToPixel(this.layout, press.hexStart);
          const b = hexToPixel(this.layout, hex);
          this.drag.set({
            offset: { q: hex.q - press.hexStart.q, r: hex.r - press.hexStart.r },
            labelDelta: { x: b.x - a.x, y: b.y - a.y },
          });
        } else {
          const world = this.toWorld(event);
          this.drag.set({
            offset: { q: 0, r: 0 },
            labelDelta: {
              x: world.x - press.worldStart.x,
              y: world.y - press.worldStart.y,
            },
          });
        }
      }
      return;
    }

    if (this.panning && this.lastPointer) {
      const dx = event.clientX - this.lastPointer.x;
      const dy = event.clientY - this.lastPointer.y;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      this.camera.update((c) => c.panBy(dx, dy));
    } else if (this.painting && this.store.continuous()) {
      // Read continuity live, not from a press-time snapshot: the armed Tool can
      // change mid-drag (a keyboard hotkey), and `applyAt` already dispatches on
      // the live Tool — so a stroke that becomes a discrete Feature stops sweeping
      // instead of mass-stamping it (issue #7, issue #27).
      this.strokeAt(hex);
    }
  }

  protected onPointerUp(event: PointerEvent): void {
    if (this.foreignPointer(event)) return;
    // A mouse reuses one pointerId across buttons, so a right/middle release
    // during a left-button gesture mustn't end it — only the owning button does.
    if (this.gestureButton !== null && event.button !== this.gestureButton) return;
    (event.target as Element).releasePointerCapture?.(event.pointerId);
    this.endGesture(event);
  }

  /**
   * A pointer the OS/browser took away mid-gesture (touch interruption, a
   * context menu, an alt-tab): abandon the gesture without committing, so a drag
   * never lands at a stale destination and no override is left stranded.
   */
  protected onPointerCancel(event: PointerEvent): void {
    if (this.foreignPointer(event)) return;
    (event.target as Element).releasePointerCapture?.(event.pointerId);
    this.cancelDrag();
    this.resetGesture();
  }

  /**
   * The cursor left the surface. A non-owning pointer's leave must not disturb
   * the active gesture (it carries no commit decision for the pointer that owns
   * it). For the owning pointer — or a plain hover with no gesture — drop the
   * hover and *abandon* any in-progress drag without committing, matching
   * {@link onPointerCancel}: a move is only ever committed by an explicit
   * release, never by the pointer wandering off the canvas. Pan and paint have
   * nothing to commit, so this simply tears the gesture down.
   */
  protected onPointerLeave(event: PointerEvent): void {
    if (this.foreignPointer(event)) return;
    this.hover.set(null);
    this.cancelDrag();
    this.resetGesture();
  }

  /** Apply the armed tool to `hex` once per hex, so a drag never double-paints. */
  private strokeAt(hex: Axial): void {
    const key = coordKey(hex);
    if (key === this.lastStroke) return;
    this.lastStroke = key;
    this.store.applyAt(hex);
  }

  private endGesture(event: PointerEvent): void {
    // Commit a Selection drag as a single edit through the unified `moveSelection`
    // (ADR-0017, issue #64): the whole live Selection moves by the drag's offset
    // (hex steps) and label delta (pixels). A refused move snaps back silently
    // otherwise, so a blocked outcome tells the user why it wouldn't land (the
    // message lives client-side, ADR-0014). A press that never crossed the threshold
    // leaves `drag` null: a plain click on an already-selected member collapses the
    // set to what was pressed — the pick the group-drag press deferred.
    const drag = this.drag();
    if (drag) {
      const outcome = this.store.moveSelection(drag.offset, drag.labelDelta);
      if (outcome === 'blocked') {
        this.toaster.show(this.transloco.translate('editorShell.moveBlocked'), 'error');
      } else if (outcome === 'noop') {
        // A drag that crossed the pixel threshold but resolved to no movement
        // (jiggled within the origin hex, or dragged back to the press point) is
        // still a plain pick: collapse a deferred group press to what was pressed,
        // exactly as a sub-threshold release does.
        this.collapseGroupPress();
      }
      this.drag.set(null);
    } else {
      this.collapseGroupPress();
    }
    // Commit a marquee box: run its world rectangle through the pure hit-test and
    // fold the contained hexes + labels into the selection (replace, or add when
    // the drag was additive). A plain box that hit nothing clears the set, like a
    // click on empty space; an additive empty box leaves it (handled by the store).
    const marquee = this.marquee();
    if (marquee) {
      const rect = rectFromCorners(marquee.a, marquee.b);
      const hits = marqueeHits(this.layout, this.store.document(), rect);
      // Decide replace-vs-add from the modifier held at *release*, not the
      // press/last-move snapshot in `marquee.additive`: a Shift/Cmd toggled after
      // the final pointer-move (without nudging the cursor) must still take, so the
      // commit honours what is actually held now — matching the live re-read in
      // onPointerMove rather than a stale flag.
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      this.store.marqueeSelect(hits.hexes, hits.labels, additive);
      this.marquee.set(null);
    }
    this.resetGesture();
  }

  /** Drop all per-gesture interaction state and release the owning pointer. */
  private resetGesture(): void {
    this.dragPress = null;
    this.selectSweep = null;
    this.painting = false;
    this.panning = false;
    this.dragging.set(false);
    this.lastPointer = null;
    this.lastStroke = null;
    this.activePointerId = null;
    this.gestureButton = null;
  }

  /** Claim the canvas for this pointer and capture it so its moves keep arriving. */
  private claimGesture(event: PointerEvent): void {
    this.activePointerId = event.pointerId;
    this.gestureButton = event.button;
    (event.target as Element).setPointerCapture?.(event.pointerId);
  }

  /**
   * Whether an active gesture is owned by a pointer other than `event`'s — the
   * one ownership test every pointer handler shares, so a second pointer can
   * never disturb the gesture in flight. `false` when no gesture is active.
   */
  private foreignPointer(event: PointerEvent): boolean {
    return (
      this.activePointerId !== null && event.pointerId !== this.activePointerId
    );
  }

  /**
   * Collapse a deferred group-drag press to the single pressed entity — the pick
   * the press postponed so a drag could move the whole set (issue #64). A no-op
   * unless the press armed a group drag.
   */
  private collapseGroupPress(): void {
    if (this.dragPress?.group) {
      this.store.select(this.dragPress.hexStart, this.dragPress.labelHit, 'replace');
    }
  }

  /**
   * Whether a plain press at `hex`/`hitId` landed on something already selected —
   * so it drags the whole set rather than re-selecting (issue #64): the pressed
   * label, the pressed cell, or a coord belonging to a selected Region (grabbable
   * by any member cell, painted or not).
   */
  private pressOnSelection(hex: Axial, hitId: string | null): boolean {
    const key = coordKey(hex);
    return this.store.selections().some((s) => {
      switch (s.kind) {
        case 'label':
          return s.id === hitId;
        case 'hex':
        case 'feature':
          return coordKey(s.coord) === key;
        case 'region':
          return !!regionById(this.store.document(), s.id)?.hexes[key];
      }
    });
  }

  /**
   * Whether the Selection holds any Hex, Feature, or Region — so a drag snaps to
   * hex steps. A labels-only selection returns false and drags by free pixels.
   */
  private selectionHasHexOrRegion(): boolean {
    return this.store.selections().some((s) => s.kind !== 'label');
  }

  /**
   * Discard any pending Select gesture without committing it: a live drag or an
   * armed (sub-threshold) press. The label/hex preview overrides are cleared (the
   * render effect snaps the entity back to its stored position) and the pending
   * press is forgotten, so a still-held pointer cannot resume the cancelled
   * gesture. Returns whether anything was actually pending — the keyboard handler
   * uses it to decide between aborting the gesture and the plain key action
   * (clear selection / delete), and to swallow Escape only when it cancelled one.
   */
  private cancelDrag(): boolean {
    const pending =
      this.drag() !== null ||
      this.dragPress !== null ||
      this.selectSweep !== null ||
      this.marquee() !== null;
    this.drag.set(null);
    this.dragPress = null;
    // A marquee abandoned mid-drag (Escape, pointer leaves/cancels) commits
    // nothing — the selection is only ever changed by an explicit release.
    this.marquee.set(null);
    // A select-sweep accumulates the selection live, so abandoning it just stops
    // adding more — the entities already swept in stay selected.
    this.selectSweep = null;
    return pending;
  }

  /**
   * Keyboard (issue #27): letters arm top-level Tools (`S` Select, `T` Terrain,
   * `F` Feature, `L` Label, `E` Erase), and `1`–`9` pick the nth
   * Subtool of the armed Tool. `Delete`/`Backspace` remove the current selection
   * (issue #29), and `Escape` cancels an in-progress drag — or clears the
   * selection when nothing is being dragged (issue #30). Undo/redo stay on
   * Cmd/Ctrl+Z. All are suppressed while a text field is focused so a typed key
   * never re-arms a tool or deletes behind it.
   */
  @HostListener('window:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    // Don't hijack keystrokes meant for a text field (a label/rename input) — a
    // "5" or "t" typed there must not arm a tool.
    if (this.isEditableTarget(event.target)) return;

    // Escape aborts a pending Select gesture (a live drag or an armed press): the
    // move is discarded and nothing is committed, so the entity stays where it was
    // — and stays selected (issue #30). `resetGesture` releases the gesture owner
    // and clears the press, so a still-held — or never-released — pointer can
    // neither resume the cancelled gesture nor wedge the canvas behind a stuck
    // owner. With nothing pending, Escape clears the selection instead.
    if (event.key === 'Escape') {
      if (this.cancelDrag()) {
        event.preventDefault();
        this.resetGesture();
      } else {
        this.store.deselect();
      }
      return;
    }

    if (event.metaKey || event.ctrlKey) {
      if (event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) this.store.redo();
      else this.store.undo();
      return;
    }

    // Delete/Backspace remove the selected entity through the store's single
    // delete gesture (issue #29). Suppressed above while a text field is focused,
    // so Backspace edits text there rather than deleting a hex behind it; and
    // suppressed here behind any other focused control (e.g. a tool button the
    // user just clicked), so the destructive shortcut belongs only to the canvas.
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (this.isInteractiveTarget(event.target)) return;
      // `preventDefault` keeps a stray Backspace from triggering browser
      // back-navigation when no field is focused.
      event.preventDefault();
      // Mid-gesture (a live drag or an armed press), abort it rather than deleting
      // behind it — otherwise the origin would be erased while the gesture stays
      // armed and the move silently no-ops on release; `resetGesture` releases the
      // still-held pointer too. With nothing pending, the delete proceeds.
      if (this.cancelDrag()) this.resetGesture();
      else this.store.deleteSelected();
      return;
    }

    const tool = TOOL_HOTKEYS[event.key.toLowerCase()];
    if (tool) {
      this.store.armTool(tool);
      return;
    }
    // `1`–`9` pick the nth Subtool of the armed Tool (relative to it, not
    // hardwired to terrain). Digit 0 has no Subtool slot.
    if (event.key >= '1' && event.key <= '9') {
      this.store.armSubtoolByIndex(Number(event.key));
    }
  }

  /** Whether `target` is a text input the user is typing into. */
  private isEditableTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
  }

  /**
   * Whether `target` is a focusable UI control (a button, link, or native form
   * control) rather than the bare canvas/body. The destructive Delete/Backspace
   * shortcut bails on these so a key pressed right after clicking, say, a tool
   * button does not delete the selection behind the focused control.
   */
  private isInteractiveTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el || !el.tagName) return false;
    const tag = el.tagName;
    return (
      tag === 'BUTTON' ||
      tag === 'A' ||
      tag === 'SELECT' ||
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      el.isContentEditable
    );
  }

  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    // A trackpad pinch arrives as a wheel event with ctrlKey set; the browser
    // reuses that flag for Ctrl+wheel on a mouse, and macOS mouse users reach
    // for Cmd (metaKey). Any of them → zoom about the cursor. Plain scroll
    // (mouse wheel or two-finger swipe) pans both axes.
    if (event.ctrlKey || event.metaKey) {
      // Tune zoom speed per device. A pinch and a Ctrl+wheel mouse both report
      // ctrlKey, so the modifier alone can't tell them apart on Windows/Linux;
      // the delta shape can. (A Cmd+wheel mac mouse uses metaKey — never a pinch.)
      const sensitivity = this.isTouchpadGesture(event)
        ? ZOOM_SENSITIVITY_TOUCHPAD
        : ZOOM_SENSITIVITY_MOUSE;
      const factor = Math.exp(
        -this.wheelDeltaPixels(event.deltaY, event, 'y') * sensitivity,
      );
      this.zoomAround(this.localPoint(event), factor);
    } else {
      const dx = this.wheelDeltaPixels(event.deltaX, event, 'x');
      const dy = this.wheelDeltaPixels(event.deltaY, event, 'y');
      // Scrolling down/right moves the content up/left, like scrolling a page.
      this.camera.update((c) => c.panBy(-dx, -dy));
    }
  }

  /**
   * Best-effort guess that a wheel event came from a trackpad rather than a
   * mouse, used only to pick the zoom sensitivity. A mac Cmd+wheel mouse sets
   * metaKey (never a pinch). Otherwise: line/page granularity is always a mouse
   * wheel, while a trackpad streams small, often fractional, pixel deltas — a
   * mouse wheel arrives in coarse integer notches.
   */
  private isTouchpadGesture(event: WheelEvent): boolean {
    if (event.metaKey) return false;
    if (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) return false;
    return (
      Math.abs(event.deltaY) < MOUSE_NOTCH_THRESHOLD ||
      !Number.isInteger(event.deltaY)
    );
  }

  /**
   * A wheel delta on the given `axis` normalised to pixels, whatever the
   * `deltaMode`. Page-mode deltas scale by the viewport extent *along that axis*
   * — width for horizontal, height for vertical.
   */
  private wheelDeltaPixels(
    delta: number,
    event: WheelEvent,
    axis: 'x' | 'y',
  ): number {
    if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
      return delta * LINE_HEIGHT;
    }
    if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
      const el = event.currentTarget as HTMLElement;
      return delta * (axis === 'x' ? el.clientWidth : el.clientHeight);
    }
    return delta;
  }

  /** Zoom about the viewport centre by one or more notches (+1 in, -1 out). */
  protected zoomByStep(direction: 1 | -1): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) return;
    const centre = {
      x: canvas.clientWidth / 2,
      y: canvas.clientHeight / 2,
    };
    this.zoomAround(centre, direction === 1 ? ZOOM_STEP : 1 / ZOOM_STEP);
  }

  /** Re-centre the world origin in the viewport at zoom 1. */
  protected recenter(): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) return;
    this.camera.set(
      Camera.initial().panBy(canvas.clientWidth / 2, canvas.clientHeight / 2),
    );
  }

  private zoomAround(anchor: { x: number; y: number }, factor: number): void {
    this.camera.update((c) => {
      const next = c.zoomAt(anchor, factor);
      return next.zoom < MIN_ZOOM || next.zoom > MAX_ZOOM ? c : next;
    });
  }

  /** Cursor position in the canvas's local CSS-pixel space. */
  private localPoint(event: PointerEvent | WheelEvent): {
    x: number;
    y: number;
  } {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /** Cursor position in world space, accounting for the current camera. */
  private toWorld(event: PointerEvent) {
    return this.camera().screenToWorld(this.localPoint(event));
  }

  private observeSize(canvas: HTMLCanvasElement): void {
    const apply = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return;
      this.renderer?.resize(width, height);
      if (!this.centred) {
        this.centred = true;
        this.camera.set(Camera.initial().panBy(width / 2, height / 2));
      } else {
        this.renderFrame();
      }
    };

    apply();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(apply);
      observer.observe(canvas);
      this.destroyRef.onDestroy(() => observer.disconnect());
    }
  }
}
