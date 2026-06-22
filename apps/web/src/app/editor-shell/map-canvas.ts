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
import { TranslocoPipe } from '@jsverse/transloco';
import { Axial, coordKey, Layout, pixelToHex, Point } from '@hexly/domain';
import { ThemeService } from '../core/theme.service';
import { terrainKey } from './catalog-keys';
import { EditorStore, SelectMode, ToolId } from './editor-store';
import { Button } from '../ui/button';
import { Coord } from '../ui/coord';
import { Eyebrow } from '../ui/eyebrow';
import { FitIcon } from '../ui/icon/glyphs/fit';
import { MinusIcon } from '../ui/icon/glyphs/minus';
import { PlusIcon } from '../ui/icon/glyphs/plus';
import { Camera } from './camera';
import { Canvas2dMapRenderer, HexDragOverride, MapRenderer } from './map-renderer';

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
 * The letter that arms each top-level Tool from the keyboard (issue #27). Region is
 * not here: it left the palette (ADR-0012), so there is no key to arm it — Regions
 * are created in the Regions panel and painted via the Inspector's Add/Remove brush.
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
  imports: [Button, Coord, Eyebrow, FitIcon, MinusIcon, PlusIcon, TranslocoPipe],
  template: `
    <canvas
      #canvas
      class="surface"
      role="img"
      [attr.aria-label]="'editorShell.hexMap' | transloco"
      [class.is-grabbing]="dragging()"
      (pointerdown)="onPointerDown($event)"
      (pointermove)="onPointerMove($event)"
      (pointerup)="onPointerUp($event)"
      (pointercancel)="onPointerCancel($event)"
      (pointerleave)="onPointerLeave($event)"
      (wheel)="onWheel($event)"
    ></canvas>

    <div class="readout">
      <app-coord>q {{ hover()?.q ?? 0 }} · r {{ hover()?.r ?? 0 }}</app-coord>
      <span class="readout-sep">·</span>
      <span appEyebrow>{{ readoutKey() | transloco }}</span>
    </div>

    <div
      class="zoom"
      role="group"
      [attr.aria-label]="'editorShell.canvas.zoom' | transloco"
    >
      <button
        type="button"
        appButton
        icon
        size="sm"
        [attr.aria-label]="'editorShell.canvas.zoomIn' | transloco"
        (click)="zoomByStep(1)"
      >
        <app-icon-plus [size]="16" />
      </button>
      <app-coord class="zoom-level">{{ zoomPercent() }}%</app-coord>
      <button
        type="button"
        appButton
        icon
        size="sm"
        [attr.aria-label]="'editorShell.canvas.zoomOut' | transloco"
        (click)="zoomByStep(-1)"
      >
        <app-icon-minus [size]="16" />
      </button>
      <button
        type="button"
        appButton
        icon
        size="sm"
        [attr.aria-label]="'editorShell.canvas.fit' | transloco"
        (click)="recenter()"
      >
        <app-icon-fit [size]="16" />
      </button>
    </div>
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      overflow: hidden;
      background: radial-gradient(
        120% 120% at 50% 0%,
        var(--canvas-bg),
        var(--canvas-mat)
      );
    }
    .surface {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
      cursor: grab;
      touch-action: none;
    }
    .surface.is-grabbing {
      cursor: grabbing;
    }
    /*
      Bottom-left: the floating tool strip now owns the top-left of the canvas
      (ADR-0013), so the hover coordinate readout drops to the opposite-free
      corner rather than sitting under the palette.
    */
    .readout {
      position: absolute;
      bottom: var(--space-4);
      left: var(--space-4);
      display: flex;
      align-items: center;
      gap: var(--space-2);
      padding: var(--space-1) var(--space-3);
      background: color-mix(in oklab, var(--surface) 86%, transparent);
      border: 1px solid var(--line);
      border-radius: var(--radius-full);
      box-shadow: var(--shadow-1);
      backdrop-filter: blur(4px);
      pointer-events: none;
    }
    .readout-sep {
      color: var(--line-strong);
    }
    /*
      Bottom-right, and lifted above the floating right dock (z-index 1, ADR-0013):
      a tall open Inspector/Regions card reaches this corner, so the zoom/fit
      controls must stay on top and clickable rather than be covered by the panel.
    */
    .zoom {
      position: absolute;
      right: var(--space-4);
      bottom: var(--space-4);
      z-index: 2;
      display: flex;
      align-items: center;
      gap: var(--space-1);
      padding: var(--space-1);
      background: color-mix(in oklab, var(--surface) 88%, transparent);
      border: 1px solid var(--line);
      border-radius: var(--radius-full);
      box-shadow: var(--shadow-2);
      backdrop-filter: blur(4px);
    }
    .zoom-level {
      min-width: 3.4em;
      text-align: center;
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
   * The in-progress label drag: the label `id`, the grab `offset` (label anchor
   * minus the grab point, so the label doesn't jump to the cursor), and the live
   * `position` shown while dragging. `null` when no drag is active. The move is
   * committed once on release, so a drag is a single undo step (issue #10).
   */
  private readonly labelDrag = signal<{
    readonly id: string;
    readonly offset: Point;
    readonly position: Point;
  } | null>(null);

  /**
   * The live label-drag mapped to the renderer's override shape, or null. The
   * renderer previews the dragged label at this position without the document
   * being rebuilt each frame, which keeps the drag preview out of the undo
   * history (the store only sees the final position on release) and avoids
   * cloning the labels array per pointer-move frame (issue #6).
   */
  protected readonly labelDragOverride = computed(() => {
    const drag = this.labelDrag();
    return drag ? { id: drag.id, position: drag.position } : null;
  });

  /**
   * The in-progress whole-Hex drag: the `from` origin (the selected hex) and the
   * `to` coordinate currently under the cursor. `null` until a press over a
   * selected Hex/Feature crosses {@link HEX_DRAG_THRESHOLD}. The renderer previews
   * the move at this destination; the store only sees the final `moveHex` on
   * release, so the drag is a single undo step (issue #30).
   */
  private readonly hexDrag = signal<HexDragOverride | null>(null);

  /**
   * A press that *may* become a Hex drag: the origin coordinate and the press
   * point in client pixels, recorded on pointer-down over a selected Hex/Feature.
   * Stays a plain field (not a signal) — it gates the move gesture but never the
   * render. `null` when no such press is armed (issue #30).
   */
  private hexDragPress: { from: Axial; clientX: number; clientY: number } | null =
    null;

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
   * The `pointerId` that owns the canvas for the duration of one gesture, or
   * `null` between gestures. A gesture (paint, pan, or a Select press/drag)
   * claims it on pointer-down and releases it on up/cancel; events from any
   * other pointer are ignored while it is held, so a second touch cannot hijack
   * the drag origin or destination behind the active one.
   */
  private activePointerId: number | null = null;

  /**
   * The mouse `button` that claimed the active gesture (0 primary, 1 middle), or
   * `null` between gestures. A mouse reports the same `pointerId` for every
   * button, so the pointerId test alone can't tell a left-button sweep from a
   * stray right/middle release during it; this lets onPointerUp ignore a release
   * from any button other than the one that owns the gesture.
   */
  private gestureButton: number | null = null;

  private readonly theme = inject(ThemeService);
  private readonly store = inject(EditorStore);
  private readonly destroyRef = inject(DestroyRef);

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
    const labelDrag = this.labelDragOverride();
    const selections = this.store.selections();
    const hexDrag = this.hexDrag();
    this.renderer?.render(camera, doc, hover, labelDrag, selections, hexDrag);
  }

  protected onPointerDown(event: PointerEvent): void {
    // One gesture owns the canvas at a time: a second pointer (e.g. another
    // finger) while one is already active is ignored, so it cannot overwrite the
    // active drag's origin or destination behind it.
    if (this.foreignPointer(event)) return;
    const hex = pixelToHex(this.layout, this.toWorld(event));
    this.hover.set(hex);

    // Middle button pans; the primary button paints/erases the armed tool. Pan
    // also stays on the wheel, so a mouse-only user is never stuck (ADR-0003).
    if (event.button === 1) {
      // A pan supersedes any armed/live Select drag (e.g. a held left button over
      // a selected hex), so the gesture pans instead of getting stuck re-targeting
      // a hex move under the pointer-move drag branch.
      this.hexDragPress = null;
      this.hexDrag.set(null);
      // A live select-sweep also yields to the pan: onPointerMove checks the sweep
      // branch before the pan branch, so a sweep left armed here would swallow the
      // pan moves.
      this.selectSweep = null;
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
      const hitId = this.renderer?.labelAt(this.localPoint(event)) ?? null;
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
      // A plain click arms a *potential* drag (issue #30). A Label drags via the
      // existing `moveLabel` path — the grab offset keeps it from jumping to the
      // cursor. A Hex/Feature arms a whole-Hex move: the press already selected it,
      // and crossing the threshold in `onPointerMove` turns it into a `moveHex`. A
      // release before the threshold is a plain click — selection only, no move.
      if (selection?.kind === 'label') {
        const label = this.store.selectedLabel();
        if (label) {
          this.labelDrag.set({
            id: label.id,
            offset: { x: label.position.x - world.x, y: label.position.y - world.y },
            position: label.position,
          });
        }
      } else if (selection?.kind === 'hex' || selection?.kind === 'feature') {
        this.hexDragPress = {
          from: selection.coord,
          clientX: event.clientX,
          clientY: event.clientY,
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
    // While a gesture is active, only its owning pointer drives it — a stray
    // second pointer never moves the hover or re-targets the drag.
    if (this.foreignPointer(event)) return;
    const hex = pixelToHex(this.layout, this.toWorld(event));
    this.hover.set(hex);

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

    // A live label drag wins over painting/panning: track the cursor, applying
    // the grab offset; the render effect previews it there until release.
    const drag = this.labelDrag();
    if (drag) {
      const world = this.toWorld(event);
      this.labelDrag.set({
        ...drag,
        position: { x: world.x + drag.offset.x, y: world.y + drag.offset.y },
      });
      return;
    }

    // An armed Hex press becomes a move once the pointer travels past the
    // threshold; thereafter every move re-targets the destination hex under the
    // cursor and the renderer previews the content there (issue #30).
    const press = this.hexDragPress;
    if (press) {
      const moved =
        Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY) >=
        HEX_DRAG_THRESHOLD;
      if (this.hexDrag() || moved) {
        this.hexDrag.set({ from: press.from, to: hex });
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
    // Only the owning pointer ends the gesture; a non-owning pointer's release
    // must not commit the active drag out from under it.
    if (this.foreignPointer(event)) return;
    // A mouse fires pointerup with the same pointerId for every button, so a
    // right/middle release during a left-button sweep would otherwise end the
    // gesture while the left button is still held. Only the button that claimed
    // the gesture ends it.
    if (this.gestureButton !== null && event.button !== this.gestureButton) return;
    (event.target as Element).releasePointerCapture?.(event.pointerId);
    this.endGesture();
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

  private endGesture(): void {
    // Commit a label drag as a single edit: `moveLabel` to the final position.
    // A plain click (no movement) lands the label back on its anchor, so the
    // commit changes nothing and records no undo step.
    const drag = this.labelDrag();
    if (drag) {
      this.store.moveLabel(drag.id, drag.position);
      this.labelDrag.set(null);
    }
    // Commit a whole-Hex drag as a single edit: `moveHex` to the destination
    // under the cursor. A press that never crossed the threshold leaves `hexDrag`
    // null, so it is a plain click — selection only, no move recorded (issue #30).
    const hexDrag = this.hexDrag();
    if (hexDrag) {
      this.store.moveHex(hexDrag.from, hexDrag.to);
      this.hexDrag.set(null);
    }
    this.resetGesture();
  }

  /** Drop all per-gesture interaction state and release the owning pointer. */
  private resetGesture(): void {
    this.hexDragPress = null;
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
      this.labelDrag() !== null ||
      this.hexDrag() !== null ||
      this.hexDragPress !== null ||
      this.selectSweep !== null;
    this.labelDrag.set(null);
    this.hexDrag.set(null);
    this.hexDragPress = null;
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
