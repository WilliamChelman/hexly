import { computed, Injectable, signal } from '@angular/core';
import { Point } from '@hexly/plugin-board';
import { Camera } from '../utils/camera';

/** Clamp the zoom so neither the dot cull nor the element layer draws at an unbounded scale. */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

/**
 * The Board's viewport transform, lifted out of the canvas so the surface's two layers share one
 * camera: the `<canvas>` dot grid (`BoardCanvasComponent`) and the DOM element overlay
 * (`BoardElementsComponent`) must pan and zoom in lockstep, or a placed element would drift off the
 * grid it sits on. Route-scoped, provided by the board View alongside the {@link BoardStore}.
 *
 * Pure transform state — the pointer gestures that drive it live in the components; this only holds the
 * {@link Camera} and the clamp every zoom passes through.
 */
@Injectable()
export class BoardCamera {
  private readonly _camera = signal(Camera.initial());
  /** The live viewport transform — the single source of truth for pan and zoom. */
  readonly camera = this._camera.asReadonly();

  /** The zoom scale, as a convenience for consumers sizing world extents into screen pixels. */
  readonly zoom = computed(() => this._camera().zoom);

  /** Replace the camera outright — first-layout centring and the fit/reset actions, which compute a whole camera. */
  set(camera: Camera): void {
    this._camera.set(camera);
  }

  /** Pan by a screen-space drag delta. */
  panBy(dx: number, dy: number): void {
    this._camera.update((c) => c.panBy(dx, dy));
  }

  /**
   * Zoom by `factor` about a fixed screen `anchor` (the cursor). The resulting zoom is *clamped* to the
   * bounds, not rejected: a step that overshoots still lands exactly on the bound (so repeated presses
   * reach 400%/25%), re-anchored so the world point under the cursor stays put. A non-finite or
   * non-positive input is dropped outright — NaN slips through `<` comparisons and would corrupt the
   * camera for good.
   */
  zoomAround(anchor: Point, factor: number): void {
    if (!Number.isFinite(factor) || factor <= 0 || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return;
    this._camera.update((c) => c.zoomTo(anchor, Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, c.zoom * factor))));
  }

  /** Where a world point lands on screen under the current camera. */
  worldToScreen(world: Point): Point {
    return this._camera().worldToScreen(world);
  }

  /** Where a screen point sits in world space under the current camera. */
  screenToWorld(screen: Point): Point {
    return this._camera().screenToWorld(screen);
  }
}
