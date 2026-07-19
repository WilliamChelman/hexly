/**
 * Screen-pixel travel a press must exceed to count as a drag rather than a click — the one threshold
 * both surface layers share (the canvas's pan-vs-deselect split and the element overlay's move-vs-pick
 * split), so a press reads the same whether it lands on empty plane or an element.
 */
export const DRAG_THRESHOLD = 4;
