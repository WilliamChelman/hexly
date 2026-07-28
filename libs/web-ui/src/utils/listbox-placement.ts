/** The caret (or input) the popup hangs off, in viewport coordinates — a slice of a `DOMRect`. */
export interface ListboxAnchor {
  left: number;
  top: number;
  bottom: number;
}

/** Where the popup lands: viewport-fixed offsets plus the height it may grow to. */
export interface ListboxPlacement {
  left: number;
  /** Set when the popup hangs below the anchor; `null` when it was flipped above. */
  top: number | null;
  /** Set when the popup was flipped above the anchor; `null` when it hangs below. */
  bottom: number | null;
  maxHeight: number;
}

/** Breathing room kept between the popup and the viewport edge it would otherwise touch. */
const MARGIN = 8;

/** The tallest a popup grows before its own list scrolls. */
export const LISTBOX_MAX_HEIGHT = 288;

/**
 * Fit a caret-anchored popup inside the viewport: hang it below the anchor when the space there
 * holds it, otherwise flip it above when that side is roomier, and in both cases cap its height to
 * the space actually available so a long list scrolls instead of running off-screen. Horizontally
 * it starts at the anchor and slides left only as far as needed to stay on screen.
 *
 * Pure and size-free by design — placement is decided from the anchor and the viewport alone, never
 * from a measurement of the rendered box, so it holds on the first frame with nothing to re-measure.
 * Flipping pins the popup's bottom edge to the anchor's top (a CSS `bottom`), which lets a short list
 * grow upward from the caret without knowing its height.
 */
export function placeListbox(
  anchor: ListboxAnchor,
  width: number,
  viewport: { width: number; height: number },
  desiredHeight = LISTBOX_MAX_HEIGHT,
): ListboxPlacement {
  const below = viewport.height - anchor.bottom - MARGIN;
  const above = anchor.top - MARGIN;
  const left = Math.max(MARGIN, Math.min(anchor.left, viewport.width - width - MARGIN));

  // Below is the resting place; only a side that both fails to fit and is the smaller one loses.
  if (below < desiredHeight && above > below) {
    return { left, top: null, bottom: viewport.height - anchor.top, maxHeight: Math.min(desiredHeight, above) };
  }
  return { left, top: anchor.bottom, bottom: null, maxHeight: Math.min(desiredHeight, below) };
}
