import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { Point } from '@hexly/plugin-board';
import { ColorSchemeService, isTrackpadWheel, wheelDeltaPixels } from '@hexly/web-core';
import { DesignToken, designTokenInitial, readDesignToken } from '@hexly/web-styles';
import { ENTITY_SESSION } from '@hexly/web-entity';
import { Camera, fitCamera } from '../utils/camera';
import { DRAG_THRESHOLD } from '../utils/gesture';
import { BoardCamera, MIN_ZOOM } from '../services/board-camera';
import { BoardImagePlacement } from '../services/board-image-placement';
import { BoardEmbedPlacement } from '../services/board-embed-placement';
import { BoardStore, ToolId } from '../services/board-store';
import { ZoomControlComponent } from './zoom-control.component';

/** Multiplier applied per zoom-button press. */
const ZOOM_STEP = 1.15;
/**
 * Wheel-zoom sensitivity `k` in `e^(-Δy · k)`. A trackpad pinch streams tiny deltas, so it needs a
 * higher `k` than a mouse's chunky notches to feel as fast.
 */
const ZOOM_SENSITIVITY_TOUCHPAD = 0.006;
const ZOOM_SENSITIVITY_MOUSE = 0.002;
/** World-pixel spacing of the reference dot grid — the surface's feedback for pan/zoom. */
const GRID_SPACING = 48;
/** The token the reference dots take their colour from, named once and manifest-typed (ADR-0075). */
const DOT_TOKEN: DesignToken = '--color-line';
/** A grid dot's drawn radius in screen pixels, held roughly constant across zoom. */
const DOT_RADIUS = 1;
/** Screen-pixel breathing room fit-to-content leaves around the framed elements. */
const FIT_PADDING = 64;
/** Fit-to-content's zoom ceiling: fitting one small element must not blow the view up past 100%. */
const FIT_MAX_ZOOM = 1;

/**
 * What a completed empty-plane click (a primary press that never crossed {@link DRAG_THRESHOLD}) does.
 * Pure, so the click policy is testable apart from the pointer plumbing:
 *
 * - Select: clear the selection — the empty plane has nothing to pick.
 * - A placement Tool while an element is armed: only deselect (which disarms). "Click away to finish"
 *   an armed Text Block must not place the next block in the same gesture — under a sticky Tool that
 *   cascades forever (#268); the *next* click places.
 * - A placement Tool, nothing armed: place — but only while the session is writable (ADR-0037).
 *   `writable` is a live signal that can flip mid-session; the editing chrome hides, and the canvas
 *   must not keep mutating through the hidden palette's leftover Tool. Deselect stays available
 *   read-only: it touches transient UI state, never the document.
 */
export function emptyPlaneClickAction(
  tool: ToolId,
  armedElement: string | null,
  writable: boolean,
): 'deselect' | 'place' | 'none' {
  if (tool === 'select' || armedElement !== null) return 'deselect';
  return writable ? 'place' : 'none';
}

/**
 * The live board surface's background layer: an infinite, pannable, zoomable plane on a Canvas
 * (ADR-0003, #263). It draws the reference dot grid and owns the empty-space gestures — dragging pans,
 * the cluster zoom. Wheel/pinch pan-zoom is delegated from the board View's host (so a wheel over an
 * element box in the sibling overlay still reaches this camera, ADR-0062) into the public {@link onWheel}.
 * The Board Elements render in the DOM overlay above it
 * (`BoardElementsComponent`); both read the same route-scoped {@link BoardCamera}, so grid and elements
 * pan and zoom in lockstep.
 *
 * Tool-aware (#267, #268): a primary *click* on empty plane — a press released within
 * {@link DRAG_THRESHOLD} — applies the armed Tool on pointerup, at the world point the press started:
 * a placement Tool (Box, Text, Image, Embed) places its element there, Select clears the selection
 * (see {@link emptyPlaneClickAction} for the armed-element and read-only exceptions). Placement waits
 * for the release so the click-vs-drag split applies to every Tool: a left-drag always pans, whatever
 * is armed, and a cancelled Image/Embed chooser is not reopened by the pan that follows.
 */
@Component({
  selector: 'app-board-canvas',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ZoomControlComponent, TranslocoPipe],
  template: `
    <canvas
      #canvas
      class="absolute inset-0 w-full h-full block touch-none"
      role="img"
      [attr.aria-label]="'board.canvas.label' | transloco"
      [class.cursor-grab]="!panning()"
      [class.cursor-grabbing]="panning()"
      (pointerdown)="onPointerDown($event)"
      (pointermove)="onPointerMove($event)"
      (pointerup)="onPointerUp($event)"
      (pointercancel)="onPointerCancel($event)"
      (pointerleave)="onPointerLeave($event)"
    ></canvas>

    <!-- Zoom/fit controls, bottom-right. z-[1] lifts the cluster above the sibling element overlay —
         the same stacking the palette and Inspector get in the board View — or an element box painted
         over this corner steals the buttons' clicks. -->
    <app-board-zoom-control
      class="absolute right-4 bottom-4 z-[1]"
      [percent]="zoomPercent()"
      (zoomIn)="zoomByStep(1)"
      (zoomOut)="zoomByStep(-1)"
      (resetZoom)="resetZoom()"
      (fit)="fitContent()"
    />
  `,
  styles: `
    @reference '#app-styles.css';

    /*
      No position of its own — the shell positions it full-bleed, and omitting it lets the shell's
      inline 'absolute inset-0' win; that 'absolute' already makes the host the containing block for
      the overlays. Deliberately NOT 'isolate': the zoom control's z-[1] must outrank the sibling
      element overlay's boxes in the board View's stacking context, and an isolated host would trap
      it beneath them.
    */
    :host {
      @apply overflow-hidden;
      background:
        radial-gradient(110% 85% at 50% -6%, var(--color-canvas-glow), transparent 60%),
        linear-gradient(165deg, var(--color-canvas-bg), var(--color-canvas-mat));
    }
  `,
})
export class BoardCanvasComponent {
  private readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  private readonly cam = inject(BoardCamera);
  private readonly store = inject(BoardStore);
  private readonly imagePlacement = inject(BoardImagePlacement);
  private readonly embedPlacement = inject(BoardEmbedPlacement);
  /** The central session; its live `writable()` gates every placing gesture (ADR-0037). */
  private readonly session = inject(ENTITY_SESSION);

  /** Whether an empty-space pan drag is in progress — drives the grab/grabbing cursor. */
  protected readonly panning = signal(false);

  protected readonly zoomPercent = computed(() => Math.round(this.cam.zoom() * 100));

  private readonly colorScheme = inject(ColorSchemeService);
  private readonly destroyRef = inject(DestroyRef);

  private ctx: CanvasRenderingContext2D | null = null;
  /** The live devicePixelRatio — not captured once: {@link trackDevicePixelRatio} re-reads it per monitor. */
  private dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  private width = 0;
  private height = 0;
  private dotColor = designTokenInitial(DOT_TOKEN);
  private centred = false;

  /**
   * The active empty-plane press. `moved` flips once the pointer crosses {@link DRAG_THRESHOLD} — a
   * press that never moves is a click (place/deselect, applied on release), one that moves is a pan.
   * `button` decides which button owns the gesture; `world` is the down point, captured at the press so
   * a placed element lands where the press *started*, not wherever sub-threshold jitter released it.
   */
  private press: { button: number; moved: boolean; start: Point; last: Point; world: Point } | null = null;
  private activePointerId: number | null = null;

  constructor() {
    // Reading the camera inside renderFrame() registers it as a dependency, so a pan/zoom repaints.
    effect(() => this.renderFrame());

    // A ColorScheme switch re-reads the dot colour via getComputedStyle, then repaints untracked.
    effect(() => {
      this.colorScheme.colorScheme();
      if (!this.ctx) return;
      this.refreshTheme();
      untracked(() => this.renderFrame());
    });

    afterNextRender(() => {
      const canvas = this.canvasRef()?.nativeElement;
      if (!canvas) return;
      this.ctx = canvas.getContext('2d');
      this.refreshTheme();
      this.observeSize(canvas);
      this.trackDevicePixelRatio(canvas);
    });
  }

  protected onPointerDown(event: PointerEvent): void {
    if (this.foreignPointer(event)) return;
    // Primary and middle buttons act; right/aux keep the context menu.
    if (event.button !== 0 && event.button !== 1) return;
    this.activePointerId = event.pointerId;
    (event.target as Element).setPointerCapture?.(event.pointerId);
    // Every press starts as a potential pan; whether it *clicks* (place/deselect) is decided on release,
    // once the drag threshold has had its say — see onPointerUp.
    const start = { x: event.clientX, y: event.clientY };
    this.press = { button: event.button, moved: false, start, last: start, world: this.toWorld(event) };
  }

  protected onPointerMove(event: PointerEvent): void {
    if (this.foreignPointer(event) || !this.press) return;
    const dx = event.clientX - this.press.last.x;
    const dy = event.clientY - this.press.last.y;
    this.press.last = { x: event.clientX, y: event.clientY };
    // The press promotes to a pan only past the threshold, so a click that jitters a pixel still reads
    // as a click (place/deselect); once panning, it tracks the pointer smoothly.
    const travel = Math.hypot(event.clientX - this.press.start.x, event.clientY - this.press.start.y);
    if (travel >= DRAG_THRESHOLD) {
      this.press.moved = true;
      this.panning.set(true);
    }
    if (this.press.moved && (dx !== 0 || dy !== 0)) this.cam.panBy(dx, dy);
  }

  protected onPointerUp(event: PointerEvent): void {
    if (this.foreignPointer(event)) return;
    (event.target as Element).releasePointerCapture?.(event.pointerId);
    const press = this.press;
    this.endPress();
    // Only a primary press that never became a pan is a click; what it does — place under a placement
    // Tool, deselect under Select or to finish an armed element, nothing read-only — is the pure
    // {@link emptyPlaneClickAction} policy.
    if (!press || press.button !== 0 || press.moved) return;
    const action = emptyPlaneClickAction(this.store.tool(), this.store.armed(), this.session.writable());
    if (action === 'deselect') this.store.deselect();
    else if (action === 'place') this.placeAt(this.store.tool(), press.world);
  }

  /**
   * Place the armed Tool's element at world point `world` (the press's down point). Image and Embed
   * can't place synchronously (they need an Asset URL / target choice first), so they route to their
   * async choosers instead; Box and Text land at once and select.
   */
  private placeAt(tool: ToolId, world: Point): void {
    if (tool === 'text') this.store.addText(world);
    else if (tool === 'image') this.imagePlacement.place(world);
    else if (tool === 'embed') this.embedPlacement.place(world);
    else this.store.addElement(world);
  }

  /** A pointer the OS/browser took away mid-gesture: end the pan where it stands, nothing to commit. */
  protected onPointerCancel(event: PointerEvent): void {
    if (this.foreignPointer(event)) return;
    (event.target as Element).releasePointerCapture?.(event.pointerId);
    this.endPress();
  }

  protected onPointerLeave(event: PointerEvent): void {
    if (this.foreignPointer(event)) return;
    this.endPress();
  }

  /**
   * Pan/zoom from a wheel gesture. Public because the wheel listener lives on the board View's host, not
   * this canvas: the DOM element overlay is a sibling layer above the canvas, so a wheel over an element
   * box never reaches the canvas — the shared ancestor catches wheels from both layers and delegates the
   * math here (ADR-0062, board-view.component.ts). Anchors zoom about the cursor using this canvas' own
   * full-bleed rect, so the anchor is correct wherever the event originated.
   */
  onWheel(event: WheelEvent): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) return;
    event.preventDefault();
    // A trackpad pinch arrives as a wheel event with ctrlKey set; Ctrl/Cmd+wheel zooms about the
    // cursor, plain scroll pans both axes.
    if (event.ctrlKey || event.metaKey) {
      const sensitivity = isTrackpadWheel(event) ? ZOOM_SENSITIVITY_TOUCHPAD : ZOOM_SENSITIVITY_MOUSE;
      const factor = Math.exp(-wheelDeltaPixels(event.deltaY, event, canvas.clientHeight) * sensitivity);
      this.cam.zoomAround(this.localPoint(canvas, event), factor);
    } else {
      let dx = wheelDeltaPixels(event.deltaX, event, canvas.clientWidth);
      let dy = wheelDeltaPixels(event.deltaY, event, canvas.clientHeight);
      // Shift+wheel scrolls horizontally. Firefox swaps the axes in the event itself; Chrome/Safari
      // leave the delta on Y, so swap only when the event still reads vertical — never double-swap.
      if (event.shiftKey && dx === 0) {
        dx = dy;
        dy = 0;
      }
      // Scrolling down/right moves the content up/left, like scrolling a page.
      this.cam.panBy(-dx, -dy);
    }
  }

  /** Zoom about the viewport centre by one notch (+1 in, -1 out). */
  protected zoomByStep(direction: 1 | -1): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) return;
    const centre = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
    this.cam.zoomAround(centre, direction === 1 ? ZOOM_STEP : 1 / ZOOM_STEP);
  }

  /**
   * Frame the Board's content (the cluster's fit action): every element's world box centred in the
   * viewport with {@link FIT_PADDING} of breathing room, zoom clamped to the camera bounds and capped
   * at 100% — content far from the origin stays reachable, unlike the old reset-to-origin. An empty
   * board has nothing to frame, so it keeps the original reset: world origin centred at zoom 1.
   */
  protected fitContent(): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) return;
    const viewport = { width: canvas.clientWidth, height: canvas.clientHeight };
    const fitted = fitCamera(this.store.document().elements, viewport, {
      padding: FIT_PADDING,
      minZoom: MIN_ZOOM,
      maxZoom: FIT_MAX_ZOOM,
    });
    this.cam.set(fitted ?? Camera.initial().panBy(viewport.width / 2, viewport.height / 2));
  }

  /** Snap the zoom back to exactly 100% about the viewport centre — the world point there stays put. */
  protected resetZoom(): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) return;
    this.cam.set(this.cam.camera().zoomTo({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, 1));
  }

  private endPress(): void {
    this.panning.set(false);
    this.press = null;
    this.activePointerId = null;
  }

  /** Whether an active gesture is owned by a pointer other than `event`'s. */
  private foreignPointer(event: PointerEvent): boolean {
    return this.activePointerId !== null && event.pointerId !== this.activePointerId;
  }

  /** Cursor position in the canvas's local CSS-pixel space, relative to `el`'s rect. */
  private localPoint(el: HTMLElement, event: PointerEvent | WheelEvent): Point {
    const rect = el.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /** Cursor position in world space under the current camera. */
  private toWorld(event: PointerEvent): Point {
    return this.cam.screenToWorld(this.localPoint(event.currentTarget as HTMLElement, event));
  }

  /** Re-read the themed dot colour from the canvas's resolved styles (ADR-0007/0020). */
  private refreshTheme(): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) return;
    this.dotColor = readDesignToken(getComputedStyle(canvas), DOT_TOKEN);
  }

  /**
   * Paint one frame: the reference dot grid under the current camera. Only the dots whose world
   * coordinates fall inside the viewport are drawn, so an infinite plane costs a bounded number of dots.
   */
  private renderFrame(): void {
    const camera = this.cam.camera();
    const ctx = this.ctx;
    if (!ctx || this.width === 0 || this.height === 0) return;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);

    // The world rectangle currently on screen; snap outward to the grid so no edge dot is clipped.
    const topLeft = camera.screenToWorld({ x: 0, y: 0 });
    const bottomRight = camera.screenToWorld({ x: this.width, y: this.height });
    const startX = Math.floor(topLeft.x / GRID_SPACING) * GRID_SPACING;
    const startY = Math.floor(topLeft.y / GRID_SPACING) * GRID_SPACING;

    ctx.fillStyle = this.dotColor;
    for (let wx = startX; wx <= bottomRight.x; wx += GRID_SPACING) {
      for (let wy = startY; wy <= bottomRight.y; wy += GRID_SPACING) {
        const screen = camera.worldToScreen({ x: wx, y: wy });
        ctx.beginPath();
        ctx.arc(screen.x, screen.y, DOT_RADIUS, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** Size the backing store to the CSS box at the current {@link dpr}, then repaint (or first-centre). */
  private applySize(canvas: HTMLCanvasElement): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    this.width = width;
    this.height = height;
    canvas.width = Math.round(width * this.dpr);
    canvas.height = Math.round(height * this.dpr);
    if (!this.centred) {
      this.centred = true;
      // Open with the world origin at the viewport centre, so a fresh Board lands mid-plane.
      this.cam.set(Camera.initial().panBy(width / 2, height / 2));
    } else {
      this.renderFrame();
    }
  }

  private observeSize(canvas: HTMLCanvasElement): void {
    this.applySize(canvas);
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => this.applySize(canvas));
      observer.observe(canvas);
      this.destroyRef.onDestroy(() => observer.disconnect());
    }
  }

  /**
   * Follow the window across monitors: devicePixelRatio has no change event of its own, so listen on a
   * `(resolution: …dppx)` media query pinned to the *current* ratio — it fires exactly once, when the
   * ratio stops matching (a different-DPI screen). Re-read the ratio, resize the backing store (else the
   * dot grid renders blurry at the new density), and re-arm a fresh query for the new ratio.
   */
  private trackDevicePixelRatio(canvas: HTMLCanvasElement): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    let query: MediaQueryList | null = null;
    const onChange = (): void => {
      this.dpr = window.devicePixelRatio || 1;
      this.applySize(canvas);
      arm();
    };
    const arm = (): void => {
      query?.removeEventListener('change', onChange);
      query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
      query.addEventListener('change', onChange);
    };
    arm();
    this.destroyRef.onDestroy(() => query?.removeEventListener('change', onChange));
  }
}
