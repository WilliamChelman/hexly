/**
 * Reading a `wheel` event across mice and trackpads: normalising its delta to pixels, and guessing
 * whether it came from a trackpad. Shared by every pan/zoom surface — the World Graph, the hexmap —
 * so they agree on feel. These are primitives, not a policy: each surface decides for itself what a
 * scroll versus a pinch should *do*, and layers that decision on top of these.
 */

/** Pixels assumed per wheel line, to normalise line-mode deltas — a mouse wheel rarely reports pixels. */
const WHEEL_LINE_PX = 16;

/** Above this per-event |delta| (px), a wheel looks like a coarse mouse notch, not a trackpad stream. */
const MOUSE_NOTCH_THRESHOLD = 40;

/**
 * A wheel delta normalised to pixels, whatever the `deltaMode`. A mouse notch commonly arrives in
 * lines and a page-mode delta in pages, so the raw number is meaningless as a pixel shift until
 * scaled. `pageExtent` is the viewport size along the delta's axis — width for `deltaX`, height for
 * `deltaY` — and is consulted only to resolve the rare page-mode delta.
 */
export function wheelDeltaPixels(delta: number, event: WheelEvent, pageExtent: number): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * WHEEL_LINE_PX;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * pageExtent;
  return delta;
}

/**
 * Best-effort guess that a wheel event came from a trackpad rather than a mouse wheel: a trackpad
 * streams small, often fractional, pixel deltas, where a mouse arrives in coarse integer notches (a
 * Mac Cmd+wheel mouse sets `metaKey`, which a trackpad pinch never does). Use it to tell a
 * two-finger swipe from a wheel notch, or to pick a zoom sensitivity — never as a correctness gate,
 * since a slow mouse wheel or an exotic device can fool it either way.
 */
export function isTrackpadWheel(event: WheelEvent): boolean {
  if (event.metaKey) return false;
  if (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) return false;
  return Math.abs(event.deltaY) < MOUSE_NOTCH_THRESHOLD || !Number.isInteger(event.deltaY);
}
