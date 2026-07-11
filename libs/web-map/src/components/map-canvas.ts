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
import { ThemeService, ToasterService, isTrackpadWheel, wheelDeltaPixels } from '@hexly/web-core';
import { terrainKey } from '../utils/catalog-keys';
import { HexMapStore, SelectMode } from '../services/hexmap-store';
import { toolForHotkey } from './tools';
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
 * Wheel-zoom sensitivity `k` in `e^(-Δy · k)`. A trackpad pinch streams tiny
 * deltas, so it needs a higher `k` than a mouse's chunky notches to feel as fast.
 */
const ZOOM_SENSITIVITY_TOUCHPAD = 0.006;
const ZOOM_SENSITIVITY_MOUSE = 0.002;
/** The placeholder text a freshly-dropped Label carries until it is edited. */
const NEW_LABEL_TEXT = 'Label';
/** Screen-pixel travel a press must exceed to count as a drag rather than a click. */
const HEX_DRAG_THRESHOLD = 4;

/**
 * The live map surface: an infinite, pannable, zoomable hex plane on a Canvas.
 * Owns interaction state — the {@link Camera} transform and the hovered hex —
 * and delegates all drawing to a {@link MapRenderer}.
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
    <app-coord-readout class="absolute bottom-4 left-4" [coord]="hover()" [terrainKey]="readoutKey()" />

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
    @reference '#app-styles.css';

    /*
      No position of its own — the shell positions it full-bleed, and omitting it
      lets the shell's inline 'absolute inset-0' win. 'isolation' confines the
      grain blend to the map and makes the host the containing block for the
      overlays below.
    */
    :host {
      @apply overflow-hidden isolate;
      background:
        radial-gradient(110% 85% at 50% -6%, var(--color-canvas-glow), transparent 60%),
        linear-gradient(165deg, var(--color-canvas-bg), var(--color-canvas-mat));
    }
    /*
      Paper tooth: tiling desaturated SVG fractal-noise, blended low (multiply on
      light, screen on dark). No z-index — DOM order keeps it below readout/zoom.
    */
    .field-grain {
      @apply absolute inset-0 pointer-events-none opacity-[0.06] mix-blend-multiply;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
      background-size: 180px 180px;
    }
    :host-context([data-theme='dark']) .field-grain {
      @apply opacity-[0.05] mix-blend-screen;
    }
    /* Soft edge vignette: clear centre, sinking to the themed edge ink at the corners. */
    .field-vignette {
      @apply absolute inset-0 pointer-events-none;
      background: radial-gradient(120% 90% at 50% 42%, transparent 56%, var(--color-canvas-edge) 100%);
    }
  `,
})
export class MapCanvas {
  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  /** Pointy-top hexes, origin at world 0. */
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

  protected readonly zoomPercent = computed(() => Math.round(this.camera().zoom * 100));

  /**
   * The live Selection drag: `offset` in axial hex steps, `labelDelta` in world
   * pixels. A hex/region selection snaps to hex steps; a labels-only selection
   * moves by free pixels (`offset` stays zero). The renderer previews from this;
   * the store only sees the final commit on release, so a drag is one undo step.
   */
  private readonly drag = signal<{
    readonly offset: Axial;
    readonly labelDelta: Point;
  } | null>(null);

  /**
   * The in-progress marquee box-selection: origin `a` and cursor `b` in world
   * space (so the box tracks content under pan/zoom), `additive` when Shift/Cmd
   * accumulates into the set rather than replacing.
   */
  private readonly marquee = signal<{
    readonly a: Point;
    readonly b: Point;
    readonly additive: boolean;
  } | null>(null);

  /**
   * A press that may become a Selection drag. `snapped`: the Selection holds a
   * hex/region, so the drag snaps to hex steps rather than free pixels. `group`:
   * the press landed on something already selected, so a drag moves the whole
   * set and a plain release collapses to what was clicked. Plain field, not a
   * signal — it gates the gesture, never the render.
   */
  private dragPress: {
    worldStart: Point;
    hexStart: Axial;
    labelHit: string | null;
    clientX: number;
    clientY: number;
    snapped: boolean;
    group: boolean;
  } | null = null;

  /**
   * An in-progress modifier select-sweep: dragging with Cmd/Ctrl (`add-top`) or
   * Shift (`add-stack`) adds each hex the pointer enters. `last` dedupes
   * re-entries. Commits live as it goes — selection is transient view state, so
   * no undo step.
   */
  private selectSweep: { mode: SelectMode; last: string } | null = null;

  /**
   * The `pointerId` that owns the canvas for one gesture; other pointers are
   * ignored while it's held.
   */
  private activePointerId: number | null = null;

  /**
   * The mouse `button` that claimed the gesture. A mouse reuses one `pointerId`
   * across buttons, so pointerId alone can't tell a stray right/middle release
   * from the owning one.
   */
  private gestureButton: number | null = null;

  private readonly theme = inject(ThemeService);
  private readonly store = inject(HexMapStore);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toaster = inject(ToasterService);
  private readonly transloco = inject(TranslocoService);

  /**
   * Translation key for the hover readout: the painted terrain, "Void" for an
   * unpainted coordinate, or "no hex" off-canvas. Terrain ids are
   * schema-constrained to the built-ins, so the key always resolves.
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
    // Reading the signals inside renderFrame() registers them as dependencies.
    effect(() => this.renderFrame());

    // Theme switches re-read the renderer's cached palette — the one place that
    // pays for a style read, keeping the per-frame path free of
    // `getComputedStyle`. Render inputs are read untracked so only a theme
    // switch drives this costlier path.
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
   * Paint one frame — the single render call site. Every signal is read into a
   * local *before* the null-guarded `render` call: `this.renderer?.render(...)`
   * would skip evaluating the arguments while the renderer is still null, so
   * the signals would go untracked and the effect would never repaint again.
   */
  private renderFrame(): void {
    const camera = this.camera();
    const doc = this.store.document();
    const hover = this.hover();
    const drag = this.drag();
    // The committed set is read unconditionally so the effect still repaints on
    // a normal selection change; a live marquee then overrides it with a preview
    // of what releasing would select.
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
      selections = this.store.marqueePreview(hits.hexes, hits.labels, marqueeState.additive);
    } else if (drag) {
      // A live drag previews exactly what releasing would commit, from the same
      // query the store commits from. A blocked plan washes the contested cells
      // red and leaves the group in place, since releasing would snap back.
      const { plan, labelPositions: previewLabels } = this.store.previewSelectionMove(drag.offset, drag.labelDelta);
      if (plan.blocked) {
        blockedCells = plan.cells;
      } else {
        movePreview = plan.hexes;
        const { offset } = drag;
        selections = selections.map((s) =>
          s.kind === 'hex' || s.kind === 'feature' ? { ...s, coord: addAxial(s.coord, offset) } : s,
        );
        labelPositions = previewLabels;
        // An empty plan yields an empty map the renderer treats as "no override".
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

    // Middle button pans; the primary button paints/erases the armed tool.
    if (event.button === 1) {
      // A pan supersedes any armed Select gesture — onPointerMove checks the
      // drag/sweep/marquee branches before the pan branch, so one left armed
      // here would swallow the pan moves.
      this.dragPress = null;
      this.drag.set(null);
      this.selectSweep = null;
      this.marquee.set(null);
      this.claimGesture(event);
      this.panning = true;
      this.dragging.set(true);
      this.lastPointer = { x: event.clientX, y: event.clientY };
      return;
    }

    // Right/aux buttons must not paint or steal the context menu — and they
    // neither claim the gesture nor capture the pointer, so a right-click never
    // strands a captured-but-unowned pointer.
    if (event.button !== 0) return;
    this.claimGesture(event);

    const world = this.toWorld(event);

    // Select is the only selection path; under a painting Tool the same click
    // falls through and paints the hex beneath a label. Precedence
    // (Label → Feature → Hex, clear on empty) lives in the store — the canvas
    // only supplies the hex under the pointer and the label hit.
    if (this.store.tool() === 'select') {
      // The Marquee Subtool drags a box anywhere, even over painted hexes.
      // Shift/Cmd accumulates boxes; a plain box replaces.
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
      // A plain press on something already selected arms a group drag of the
      // whole set; the collapse to the pressed entity is deferred to a plain
      // release, so click-to-pick still works.
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
      // Shift toggles the whole stack at the coordinate, Cmd/Ctrl the topmost
      // entity; a plain click replaces (and cycles). Cmd/Ctrl wins if both are held.
      const mode: SelectMode = event.shiftKey
        ? 'toggle-stack'
        : event.metaKey || event.ctrlKey
          ? 'toggle-top'
          : 'replace';
      const before = this.store.selections().length;
      const selection = this.store.select(hex, hitId, mode);
      const grew = this.store.selections().length > before;
      // A modifier press becomes an add-only sweep (never toggles a hex back
      // off) — but only when the press *grew* the set: one that toggled an
      // entity off or hit empty Void must not start a drag that re-adds or
      // mass-selects from nothing.
      if (mode !== 'replace') {
        if (grew) {
          this.selectSweep = {
            mode: mode === 'toggle-stack' ? 'add-stack' : 'add-top',
            last: coordKey(hex),
          };
        }
        return;
      }
      // Arm a *potential* drag of the picked entity: crossing the threshold
      // turns it into a move; a release before the threshold stays a plain click.
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

    // A live marquee re-targets its far corner each move and re-reads the
    // modifier, so toggling Shift/Cmd mid-drag flips additive.
    const marquee = this.marquee();
    if (marquee) {
      this.marquee.set({
        a: marquee.a,
        b: this.toWorld(event),
        additive: event.shiftKey || event.metaKey || event.ctrlKey,
      });
      return;
    }

    // A select-sweep folds each newly-entered hex into the set, once per hex.
    const sweep = this.selectSweep;
    if (sweep) {
      // Releasing the modifier mid-drag ends the sweep; what's already swept in
      // stays selected.
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

    // An armed press becomes a Selection drag past the threshold; each move
    // recomputes the offset and the render effect previews it until release.
    const press = this.dragPress;
    if (press) {
      const moved = Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY) >= HEX_DRAG_THRESHOLD;
      if (this.drag() || moved) {
        if (press.snapped) {
          const a = hexToPixel(this.layout, press.hexStart);
          const b = hexToPixel(this.layout, hex);
          this.drag.set({
            offset: {
              q: hex.q - press.hexStart.q,
              r: hex.r - press.hexStart.r,
            },
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
      // Continuity is read live, not from a press-time snapshot: a hotkey can
      // change the Tool mid-drag, and a stroke that becomes a discrete Feature
      // must stop sweeping instead of mass-stamping it.
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
   * The cursor left the surface: drop the hover and abandon any in-progress
   * drag without committing — a move is only ever committed by an explicit
   * release, never by the pointer wandering off the canvas.
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
    // Commit a Selection drag as a single edit; a blocked move toasts why it
    // wouldn't land (a refused move snaps back silently otherwise). A press
    // that never crossed the threshold leaves `drag` null: a plain click on an
    // already-selected member collapses the set to what was pressed.
    const drag = this.drag();
    if (drag) {
      const outcome = this.store.moveSelection(drag.offset, drag.labelDelta);
      if (outcome === 'blocked') {
        this.toaster.show(this.transloco.translate('editorShell.moveBlocked'), 'error');
      } else if (outcome === 'noop') {
        // A drag that resolved to no movement (jiggled within the origin hex, or
        // dragged back to the press point) is still a plain pick.
        this.collapseGroupPress();
      }
      this.drag.set(null);
    } else {
      this.collapseGroupPress();
    }
    // Commit a marquee box: fold the contained hexes + labels into the selection.
    // A plain box that hit nothing clears the set; an additive empty box leaves it.
    const marquee = this.marquee();
    if (marquee) {
      const rect = rectFromCorners(marquee.a, marquee.b);
      const hits = marqueeHits(this.layout, this.store.document(), rect);
      // Replace-vs-add comes from the modifier held at *release*, not the
      // press-time snapshot: a Shift/Cmd toggled after the final pointer-move
      // must still take.
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
   * Whether an active gesture is owned by a pointer other than `event`'s, so a
   * second pointer can never disturb the gesture in flight.
   */
  private foreignPointer(event: PointerEvent): boolean {
    return this.activePointerId !== null && event.pointerId !== this.activePointerId;
  }

  /**
   * Collapse a deferred group-drag press to the single pressed entity. A no-op
   * unless the press armed a group drag.
   */
  private collapseGroupPress(): void {
    if (this.dragPress?.group) {
      this.store.select(this.dragPress.hexStart, this.dragPress.labelHit, 'replace');
    }
  }

  /**
   * Whether a plain press at `hex`/`hitId` landed on something already selected:
   * the pressed label, the pressed cell, or a coord belonging to a selected
   * Region (grabbable by any member cell, painted or not).
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
   * armed (sub-threshold) press. Returns whether anything was pending — the
   * keyboard handler uses it to decide between aborting the gesture and the
   * plain key action (clear selection / delete).
   */
  private cancelDrag(): boolean {
    const pending =
      this.drag() !== null || this.dragPress !== null || this.selectSweep !== null || this.marquee() !== null;
    this.drag.set(null);
    this.dragPress = null;
    this.marquee.set(null);
    this.selectSweep = null;
    return pending;
  }

  /**
   * Keyboard: letters arm Tools, `1`–`9` pick Subtools, Delete/Backspace remove
   * the selection, Escape cancels a drag (or clears the selection), Cmd/Ctrl+Z
   * undoes/redoes. All suppressed while a text field is focused.
   */
  @HostListener('window:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    // Don't hijack keystrokes meant for a text field (a label/rename input) — a
    // "5" or "t" typed there must not arm a tool.
    if (this.isEditableTarget(event.target)) return;

    // Escape aborts a pending Select gesture without committing; `resetGesture`
    // releases the owner so a still-held pointer can neither resume the
    // cancelled gesture nor wedge the canvas. With nothing pending, Escape
    // clears the selection instead.
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

    // Suppressed behind any focused control, so the destructive shortcut
    // belongs only to the canvas.
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (this.isInteractiveTarget(event.target)) return;
      // `preventDefault` keeps a stray Backspace from triggering browser
      // back-navigation when no field is focused.
      event.preventDefault();
      // Mid-gesture, abort it rather than deleting behind it — otherwise the
      // origin is erased while the gesture stays armed and the move silently
      // no-ops on release.
      if (this.cancelDrag()) this.resetGesture();
      else this.store.deleteSelected();
      return;
    }

    const tool = toolForHotkey(event.key);
    if (tool) {
      this.store.armTool(tool);
      return;
    }
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
   * Whether `target` is a focusable UI control rather than the bare canvas/body,
   * so Delete/Backspace pressed behind a focused control never deletes the selection.
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
    // A trackpad pinch arrives as a wheel event with ctrlKey set; Ctrl/Cmd+wheel
    // zooms about the cursor, plain scroll pans both axes.
    const el = event.currentTarget as HTMLElement;
    if (event.ctrlKey || event.metaKey) {
      // A pinch and a Ctrl+wheel mouse both report ctrlKey, so the modifier
      // alone can't tell them apart — the delta shape can.
      const sensitivity = isTrackpadWheel(event) ? ZOOM_SENSITIVITY_TOUCHPAD : ZOOM_SENSITIVITY_MOUSE;
      const factor = Math.exp(-wheelDeltaPixels(event.deltaY, event, el.clientHeight) * sensitivity);
      this.zoomAround(this.localPoint(event), factor);
    } else {
      const dx = wheelDeltaPixels(event.deltaX, event, el.clientWidth);
      const dy = wheelDeltaPixels(event.deltaY, event, el.clientHeight);
      // Scrolling down/right moves the content up/left, like scrolling a page.
      this.camera.update((c) => c.panBy(-dx, -dy));
    }
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
    this.camera.set(Camera.initial().panBy(canvas.clientWidth / 2, canvas.clientHeight / 2));
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
