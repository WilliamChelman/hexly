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
import { ZoomControlComponent } from './zoom-control.component';

/** Clamp the zoom so the dot cull never has to draw an unbounded point count. */
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
/** Multiplier applied per zoom-button press. */
const ZOOM_STEP = 1.15;
/**
 * Wheel-zoom sensitivity `k` in `e^(-Δy · k)`. A trackpad pinch streams tiny deltas, so it needs a
 * higher `k` than a mouse's chunky notches to feel as fast.
 */
const ZOOM_SENSITIVITY_TOUCHPAD = 0.006;
const ZOOM_SENSITIVITY_MOUSE = 0.002;
/** World-pixel spacing of the reference dot grid — the surface's only feedback for pan/zoom while empty. */
const GRID_SPACING = 48;
/** A grid dot's drawn radius in screen pixels, held roughly constant across zoom. */
const DOT_RADIUS = 1;

/**
 * The live board surface: an infinite, pannable, zoomable plane on a Canvas (ADR-0003, #263). It owns
 * the {@link Camera} transform and draws a reference dot grid so pan and zoom read on the still-empty
 * plane. Element rendering layers on in a later ticket; for now the canvas is a pure read affordance —
 * dragging empty space pans, the wheel and the zoom cluster zoom.
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
      (wheel)="onWheel($event)"
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

  /** The viewport transform — the single source of truth for pan and zoom. */
  protected readonly camera = signal(Camera.initial());
  /** Whether an empty-space pan drag is in progress — drives the grab/grabbing cursor. */
  protected readonly panning = signal(false);

  protected readonly zoomPercent = computed(() => Math.round(this.camera().zoom * 100));

  private readonly theme = inject(ThemeService);
  private readonly destroyRef = inject(DestroyRef);

  private ctx: CanvasRenderingContext2D | null = null;
  private readonly dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  private width = 0;
  private height = 0;
  private dotColor = 'rgba(0,0,0,0.18)';
  private centred = false;

  /** The `pointerId` that owns the canvas for the active pan; other pointers are ignored while it's held. */
  private activePointerId: number | null = null;
  private lastPointer: Point | null = null;

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
    // Any button drags the plane: an empty surface has nothing else to grab (#263). Right/aux buttons
    // keep the context menu, so only the primary and middle buttons start a pan.
    if (event.button !== 0 && event.button !== 1) return;
    this.activePointerId = event.pointerId;
    (event.target as Element).setPointerCapture?.(event.pointerId);
    this.panning.set(true);
    this.lastPointer = { x: event.clientX, y: event.clientY };
  }

  protected onPointerMove(event: PointerEvent): void {
    if (this.foreignPointer(event) || !this.lastPointer) return;
    const dx = event.clientX - this.lastPointer.x;
    const dy = event.clientY - this.lastPointer.y;
    this.lastPointer = { x: event.clientX, y: event.clientY };
    this.camera.update((c) => c.panBy(dx, dy));
  }

  protected onPointerUp(event: PointerEvent): void {
    if (this.foreignPointer(event)) return;
    (event.target as Element).releasePointerCapture?.(event.pointerId);
    this.endPan();
  }

  /** A pointer the OS/browser took away mid-gesture: end the pan where it stands, nothing to commit. */
  protected onPointerCancel(event: PointerEvent): void {
    if (this.foreignPointer(event)) return;
    (event.target as Element).releasePointerCapture?.(event.pointerId);
    this.endPan();
  }

  protected onPointerLeave(event: PointerEvent): void {
    if (this.foreignPointer(event)) return;
    this.endPan();
  }

  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    const el = event.currentTarget as HTMLElement;
    // A trackpad pinch arrives as a wheel event with ctrlKey set; Ctrl/Cmd+wheel zooms about the
    // cursor, plain scroll pans both axes.
    if (event.ctrlKey || event.metaKey) {
      // A pinch and a Ctrl+wheel mouse both report ctrlKey, so the modifier alone can't tell them
      // apart — the delta shape can.
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

  /** Zoom about the viewport centre by one notch (+1 in, -1 out). */
  protected zoomByStep(direction: 1 | -1): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) return;
    const centre = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
    this.zoomAround(centre, direction === 1 ? ZOOM_STEP : 1 / ZOOM_STEP);
  }

  /** Re-centre the world origin in the viewport at zoom 1. */
  protected recenter(): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) return;
    this.camera.set(Camera.initial().panBy(canvas.clientWidth / 2, canvas.clientHeight / 2));
  }

  private endPan(): void {
    this.panning.set(false);
    this.lastPointer = null;
    this.activePointerId = null;
  }

  /** Whether an active pan is owned by a pointer other than `event`'s, so a second pointer can't disturb it. */
  private foreignPointer(event: PointerEvent): boolean {
    return this.activePointerId !== null && event.pointerId !== this.activePointerId;
  }

  private zoomAround(anchor: Point, factor: number): void {
    this.camera.update((c) => {
      const next = c.zoomAt(anchor, factor);
      return next.zoom < MIN_ZOOM || next.zoom > MAX_ZOOM ? c : next;
    });
  }

  /** Cursor position in the canvas's local CSS-pixel space. */
  private localPoint(event: WheelEvent): Point {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
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
    const camera = this.camera();
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
