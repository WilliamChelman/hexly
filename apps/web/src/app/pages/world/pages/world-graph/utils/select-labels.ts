import { GraphPayload } from './graph-payload';

/** The current camera, as the label grid needs it: zoom, plus the visible box in *space* units. */
export interface LabelView {
  /** Screen pixels per unit of graph space. */
  readonly scale: number;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/** Declutter cell edges, in screen pixels, and a ceiling on how many labels one frame may draw. */
export interface LabelGrid {
  readonly pointCell: number;
  readonly linkCell: number;
  readonly max: number;
}

/** Point indices into `payload.nodes`, and link indices into `payload.descriptors`. */
export interface LabelSelection {
  readonly points: readonly number[];
  readonly links: readonly number[];
}

/**
 * Choose which Entities and Link Descriptors to label, given where the graph currently sits.
 *
 * cosmos.gl's own sampling rasterises points into a **screen**-sized framebuffer, so its cells are
 * anchored to the viewport: pan by half a cell and every node crosses a boundary, each cell elects
 * a different winner, and labels flicker in and out for no reason a reader can see. This anchors
 * the grid in **graph space** instead — a cell belongs to a region of the World, not a region of
 * the screen — so panning cannot change the chosen set, only which of it is on screen. Zooming
 * still changes it, which is the point: zoom in and the cells cover less World, so more labels fit.
 */
export function selectLabels(
  payload: GraphPayload,
  positions: Float32Array,
  view: LabelView,
  grid: LabelGrid,
): LabelSelection {
  const { degrees } = payload;
  const cell = grid.pointCell / quantizeScale(view.scale);

  // Elect one winner per space cell, over *every* node — not just the visible ones, so a node
  // scrolling into view arrives already holding (or already having lost) its cell.
  const winners = new Map<string, number>();
  for (let i = 0; i < payload.nodes.length; i++) {
    const key = cellKey(positions[i * 2], positions[i * 2 + 1], cell);
    const held = winners.get(key);
    if (held === undefined || beats(degrees[i], i, degrees[held], held)) winners.set(key, i);
  }

  const points = [...winners.values()]
    .filter((i) => visible(positions[i * 2], positions[i * 2 + 1], view))
    .sort((a, b) => degrees[b] - degrees[a] || a - b)
    .slice(0, grid.max);

  return { points, links: selectLinks(payload, positions, view, grid) };
}

/**
 * The same election, over the midpoints of the links that actually carry a Link Descriptor. A bare
 * link is skipped outright rather than losing on weight: it has nothing to draw, so letting it hold
 * a cell would spend that cell on nothing and blank the labelled link beside it.
 *
 * A link's weight is the degree of its busier end, so the lines into a hub — the ones a reader is
 * following — keep their descriptors when the graph is dense.
 */
function selectLinks(payload: GraphPayload, positions: Float32Array, view: LabelView, grid: LabelGrid): number[] {
  const { degrees, links, descriptors } = payload;
  const cell = grid.linkCell / quantizeScale(view.scale);

  const winners = new Map<string, number>();
  const weights = new Map<number, number>();
  const midpoints = new Map<number, [number, number]>();
  for (let link = 0; link < descriptors.length; link++) {
    if (!descriptors[link]) continue;
    const source = links[link * 2];
    const target = links[link * 2 + 1];
    const x = (positions[source * 2] + positions[target * 2]) / 2;
    const y = (positions[source * 2 + 1] + positions[target * 2 + 1]) / 2;
    const weight = Math.max(degrees[source], degrees[target]);
    weights.set(link, weight);
    midpoints.set(link, [x, y]);

    const key = cellKey(x, y, cell);
    const held = winners.get(key);
    if (held === undefined || beats(weight, link, weights.get(held) as number, held)) {
      winners.set(key, link);
    }
  }

  return [...winners.values()]
    .filter((link) => visible(...(midpoints.get(link) as [number, number]), view))
    .sort((a, b) => (weights.get(b) as number) - (weights.get(a) as number) || a - b)
    .slice(0, grid.max);
}

/**
 * Half-octave steps: the grid's cell size changes only when zoom crosses a factor of √2, so a slow
 * zoom holds a fixed label set between thresholds instead of restocking on every frame. Fine enough
 * that a step never doubles the on-screen density, coarse enough to kill the flicker.
 */
const ZOOM_STEP = Math.SQRT2;

/**
 * Snap the live zoom to {@link ZOOM_STEP} before it sizes the grid cells: the cell is `pointCell /
 * scale`, so an unquantized scale reshapes the graph-space grid on every frame — nodes drift across
 * cell boundaries and winners flip mid-pinch.
 */
function quantizeScale(scale: number): number {
  if (!(scale > 0)) return 1;
  return ZOOM_STEP ** Math.round(Math.log(scale) / Math.log(ZOOM_STEP));
}

/** Higher degree wins; an index tiebreak keeps the choice stable across frames. */
function beats(degree: number, index: number, heldDegree: number, heldIndex: number): boolean {
  return degree > heldDegree || (degree === heldDegree && index < heldIndex);
}

function cellKey(x: number, y: number, cell: number): string {
  return `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
}

function visible(x: number, y: number, view: LabelView): boolean {
  return x >= view.minX && x <= view.maxX && y >= view.minY && y <= view.maxY;
}
