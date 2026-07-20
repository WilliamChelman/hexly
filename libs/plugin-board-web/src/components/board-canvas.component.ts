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
import { isTrackpadWheel, ThemeService, wheelDeltaPixels } from '@hexly/web-core';
import { Camera } from '../utils/camera';
import { DRAG_THRESHOLD } from '../utils/gesture';
import { BoardCamera } from '../services/board-camera';
import { BoardImagePlacement } from '../services/board-image-placement';
import { BoardEmbedPlacement } from '../services/board-embed-placement';
import { BoardStore } from '../services/board-store';
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
/** A grid dot's drawn radius in screen pixels, held roughly constant across zoom. */
const DOT_RADIUS = 1;

/**
 * The live board surface's background layer: an infinite, pannable, zoomable plane on a Canvas
 * (ADR-0003, #263). It draws the reference dot grid and owns the empty-space gestures — dragging pans,
 * the cluster zoom. Wheel/pinch pan-zoom is delegated from the board View's host (so a wheel over an
 * element box in the sibling overlay still reaches this camera, ADR-0062) into the public {@link onWheel}.
 * The Board Elements render in the DOM overlay above it
 * (`BoardElementsComponent`); both read the same route-scoped {@link BoardCamera}, so grid and elements
 * pan and zoom in lockstep.
 *
 * Tool-aware (#267, #268): with a placement Tool armed (Box, Text), a primary click on empty plane
 * places that Tool's element at the clicked world point; with Select armed, a primary click on empty
 * plane clears the selection. The overlay's element boxes are `pointer-events-auto`, so a click that
 * lands on an element never reaches this canvas — only empty-plane gestures do.
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

    <!-- Zoom/reset controls, bottom-right. -->
    <app-board-zoom-control
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
      No position of its own — the shell positions it full-bleed, and omitting it lets the shell's
      inline 'absolute inset-0' win. 'isolation' makes the host the containing block for the overlays.
    */
    :host {
      @apply overflow-hidden isolate;
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

  /** Whether an empty-space pan drag is in progress — drives the grab/grabbing cursor. */
  protected readonly panning = signal(false);

  protected readonly zoomPercent = computed(() => Math.round(this.cam.zoom() * 100));

  private readonly theme = inject(ThemeService);
  private readonly destroyRef = inject(DestroyRef);

  private ctx: CanvasRenderingContext2D | null = null;
  private readonly dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  private width = 0;
  private height = 0;
  private dotColor = 'rgba(0,0,0,0.18)';
  private centred = false;

  /**
   * The active empty-plane press. `moved` flips once the pointer crosses {@link DRAG_THRESHOLD} — a
   * press that never moves is a click (place/deselect), one that moves is a pan. `button` decides which
   * button owns the gesture; `world` is the down point, where a Box lands.
   */
  private press: { button: number; moved: boolean; start: Point; last: Point; world: Point } | null = null;
  private activePointerId: number | null = null;

  constructor() {
    // Reading the camera inside renderFrame() registers it as a dependency, so a pan/zoom repaints.
    effect(() => this.renderFrame());

    // A theme switch re-reads the dot colour via getComputedStyle, then repaints untracked.
    effect(() => {
      this.theme.theme();
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
    });
  }

  protected onPointerDown(event: PointerEvent): void {
    if (this.foreignPointer(event)) return;
    // Primary and middle buttons act; right/aux keep the context menu.
    if (event.button !== 0 && event.button !== 1) return;
    this.activePointerId = event.pointerId;
    (event.target as Element).setPointerCapture?.(event.pointerId);
    const world = this.toWorld(event);

    // A placement Tool (Box, Text, Image, Embed): a primary click on empty plane places its element at the
    // clicked world point and selects it — no pan. Select is the only non-placing Tool. Image and Embed
    // can't place synchronously (they need an Asset URL / target choice first), so they route to their
    // async choosers instead.
    const tool = this.store.tool();
    if (event.button === 0 && tool !== 'select') {
      if (tool === 'text') this.store.addText(world);
      else if (tool === 'image') this.imagePlacement.place(world);
      else if (tool === 'embed') this.embedPlacement.place(world);
      else this.store.addElement(world);
      this.activePointerId = null;
      (event.target as Element).releasePointerCapture?.(event.pointerId);
      return;
    }

    const start = { x: event.clientX, y: event.clientY };
    this.press = { button: event.button, moved: false, start, last: start, world };
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
    // A primary click that never became a pan clears the selection under the Select Tool — the empty
    // plane has nothing to pick.
    if (press && press.button === 0 && !press.moved && this.store.tool() === 'select') {
      this.store.deselect();
    }
    this.endPress();
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
      const dx = wheelDeltaPixels(event.deltaX, event, canvas.clientWidth);
      const dy = wheelDeltaPixels(event.deltaY, event, canvas.clientHeight);
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

  /** Re-centre the world origin in the viewport at zoom 1. */
  protected recenter(): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) return;
    this.cam.set(Camera.initial().panBy(canvas.clientWidth / 2, canvas.clientHeight / 2));
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
    const line = getComputedStyle(canvas).getPropertyValue('--color-line').trim();
    if (line) this.dotColor = line;
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

  private observeSize(canvas: HTMLCanvasElement): void {
    const apply = () => {
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
    };

    apply();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(apply);
      observer.observe(canvas);
      this.destroyRef.onDestroy(() => observer.disconnect());
    }
  }
}
