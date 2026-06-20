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
import { Axial, coordKey, Layout, pixelToHex, terrainPalette } from '@hexly/domain';
import { ThemeService } from '../core/theme.service';
import { EditorStore, isContinuousTool } from './editor-store';
import { Button } from '../ui/button';
import { Coord } from '../ui/coord';
import { Eyebrow } from '../ui/eyebrow';
import { CompassIcon } from '../ui/icon/glyphs/compass';
import { FitIcon } from '../ui/icon/glyphs/fit';
import { MinusIcon } from '../ui/icon/glyphs/minus';
import { PlusIcon } from '../ui/icon/glyphs/plus';
import { Camera } from './camera';
import { Canvas2dMapRenderer, MapRenderer } from './map-renderer';

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
  imports: [Button, Coord, Eyebrow, CompassIcon, FitIcon, MinusIcon, PlusIcon],
  template: `
    <canvas
      #canvas
      class="surface"
      role="img"
      aria-label="Hex map"
      [class.is-grabbing]="dragging()"
      (pointerdown)="onPointerDown($event)"
      (pointermove)="onPointerMove($event)"
      (pointerup)="onPointerUp($event)"
      (pointerleave)="onPointerLeave()"
      (wheel)="onWheel($event)"
    ></canvas>

    <div class="readout">
      <app-coord>q {{ hover()?.q ?? 0 }} · r {{ hover()?.r ?? 0 }}</app-coord>
      <span class="readout-sep">·</span>
      <span appEyebrow>{{
        hover() ? (hoverTerrain() ?? 'Void') : 'No hex'
      }}</span>
    </div>

    <div class="compass" title="North">
      <app-icon-compass [size]="40" />
    </div>

    <div class="zoom" role="group" aria-label="Zoom">
      <button
        type="button"
        appButton
        icon
        size="sm"
        aria-label="Zoom in"
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
        aria-label="Zoom out"
        (click)="zoomByStep(-1)"
      >
        <app-icon-minus [size]="16" />
      </button>
      <button
        type="button"
        appButton
        icon
        size="sm"
        aria-label="Fit map"
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
    .readout {
      position: absolute;
      top: var(--space-4);
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
    .compass {
      position: absolute;
      top: var(--space-4);
      right: var(--space-4);
      color: var(--gold);
      opacity: 0.85;
      filter: drop-shadow(var(--shadow-1));
      pointer-events: none;
    }
    .zoom {
      position: absolute;
      right: var(--space-4);
      bottom: var(--space-4);
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

  private readonly theme = inject(ThemeService);
  private readonly store = inject(EditorStore);
  private readonly destroyRef = inject(DestroyRef);

  /** The terrain label under the cursor, or null when the hovered hex is Void. */
  protected readonly hoverTerrain = computed(() => {
    const hex = this.hover();
    if (!hex) return null;
    const painted = this.store.document().hexes[coordKey(hex)];
    return painted
      ? (terrainPalette.find((t) => t.id === painted.terrain)?.label ?? null)
      : null;
  });

  private renderer: MapRenderer | null = null;
  private centred = false;
  private lastPointer: { x: number; y: number } | null = null;
  /** True while a primary-button paint/erase stroke is in progress. */
  private painting = false;
  /**
   * Whether the armed stroke keeps applying as the pointer drags. Continuous for
   * terrain/erase/clear-feature; false for placing a Feature, which stamps once
   * on the initial press so a drag never mass-places duplicates (issue #7).
   */
  private continuousStroke = false;
  /** True while a middle-button pan drag is in progress. */
  private panning = false;
  /** The last hex the active stroke touched, so a drag paints each hex once. */
  private lastStroke: string | null = null;

  constructor() {
    // Repaint whenever pan, zoom, the painted document, or the hover changes.
    effect(() => {
      const camera = this.camera();
      const doc = this.store.document();
      const hover = this.hover();
      this.renderer?.render(camera, doc, hover);
    });

    // Re-read the renderer's themed colours and repaint when the theme switches.
    // The renderer caches the palette, so this is the only place it pays for a
    // style read — the per-frame render path stays free of `getComputedStyle`.
    effect(() => {
      this.theme.theme();
      if (!this.renderer) return;
      this.renderer.refreshTheme();
      this.renderer.render(
        untracked(this.camera),
        untracked(this.store.document),
        untracked(this.hover),
      );
    });

    afterNextRender(() => {
      const canvas = this.canvasRef()?.nativeElement;
      if (!canvas) return;
      this.renderer = new Canvas2dMapRenderer(canvas, this.layout);
      this.observeSize(canvas);
    });
  }

  protected onPointerDown(event: PointerEvent): void {
    (event.target as Element).setPointerCapture?.(event.pointerId);
    const hex = pixelToHex(this.layout, this.toWorld(event));
    this.hover.set(hex);

    // Middle button pans; the primary button paints/erases the armed tool. Pan
    // also stays on the wheel, so a mouse-only user is never stuck (ADR-0003).
    if (event.button === 1) {
      this.panning = true;
      this.dragging.set(true);
      this.lastPointer = { x: event.clientX, y: event.clientY };
      return;
    }

    // Only the primary button paints. Right/aux buttons must not lay down a hex
    // (and steal the right-click context menu along the way).
    if (event.button !== 0) return;

    this.painting = true;
    this.continuousStroke = isContinuousTool(this.store.tool());
    this.lastStroke = null;
    this.strokeAt(hex);
  }

  protected onPointerMove(event: PointerEvent): void {
    const hex = pixelToHex(this.layout, this.toWorld(event));
    this.hover.set(hex);

    if (this.panning && this.lastPointer) {
      const dx = event.clientX - this.lastPointer.x;
      const dy = event.clientY - this.lastPointer.y;
      this.lastPointer = { x: event.clientX, y: event.clientY };
      this.camera.update((c) => c.panBy(dx, dy));
    } else if (this.painting && this.continuousStroke) {
      this.strokeAt(hex);
    }
  }

  protected onPointerUp(event: PointerEvent): void {
    (event.target as Element).releasePointerCapture?.(event.pointerId);
    this.endGesture();
  }

  protected onPointerLeave(): void {
    this.endGesture();
    this.hover.set(null);
  }

  /** Apply the armed tool to `hex` once per hex, so a drag never double-paints. */
  private strokeAt(hex: Axial): void {
    const key = coordKey(hex);
    if (key === this.lastStroke) return;
    this.lastStroke = key;
    this.store.applyAt(hex);
  }

  private endGesture(): void {
    this.painting = false;
    this.continuousStroke = false;
    this.panning = false;
    this.dragging.set(false);
    this.lastPointer = null;
    this.lastStroke = null;
  }

  /** Keyboard: undo/redo and the terrain/eraser hotkeys shown on the palette. */
  @HostListener('window:keydown', ['$event'])
  protected onKeydown(event: KeyboardEvent): void {
    // Don't hijack keystrokes meant for a text field (a future label/rename
    // input) — a "5" typed there must not re-arm a terrain.
    if (this.isEditableTarget(event.target)) return;

    if (event.metaKey || event.ctrlKey) {
      if (event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) this.store.redo();
      else this.store.undo();
      return;
    }

    if (event.key.toLowerCase() === 'e') {
      this.store.selectTool({ kind: 'erase' });
      return;
    }
    const terrain = terrainPalette[Number(event.key) - 1];
    if (terrain) this.store.selectTool({ kind: 'terrain', id: terrain.id });
  }

  /** Whether `target` is a text input the user is typing into. */
  private isEditableTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
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
        this.renderer?.render(this.camera(), this.store.document(), this.hover());
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
