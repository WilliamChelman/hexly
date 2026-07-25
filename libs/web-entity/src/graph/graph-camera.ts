import type { Graph } from '@cosmos.gl/graph';
import { LabelView } from './select-labels';

/** How often the framing is *judged* — the slow cadence ADR-0072 chose over re-fitting on a timer. */
const REFRAME_CHECK_MS = 700;

/** How long a correction takes to glide — shorter than {@link REFRAME_CHECK_MS}, so no check lands mid-glide. */
const REFRAME_GLIDE_MS = 400;

/**
 * Slack left around the drawing on each correction — wider than cosmos.gl's own `fitView` default, so a
 * layout still growing does not overflow again on the very next check and earn a second correction.
 */
const REFRAME_PADDING = 0.15;

/**
 * The share of the viewport the drawing must keep (in its larger dimension) before the camera zooms back
 * in. A correction leaves it at ~70 %, so the layout has to contract by a third to earn the next one.
 */
const REFRAME_MIN_COVERAGE = 0.5;

/** The camera that keeps a cooling layout framed (ADR-0072). One per mount; it holds its own clock. */
export interface FramingCamera {
  /**
   * Judge the framing and correct it if it is wrong. Cheap to call every tick: it reads the drawing at
   * most once per {@link REFRAME_CHECK_MS}, and does nothing at all once the reader has taken the view.
   */
  keepFramed(): void;
  /** Frame the drawing now, without a glide — the initial fit `fitViewOnInit` gives a self-built graph. */
  fitNow(): void;
  /** The reader panned, zoomed or dragged: the camera stops judging this drawing (ADR-0072). */
  cedeToReader(): void;
  /**
   * A different drawing is on screen: judge it from scratch, including after a cession — the reader took
   * the camera over the picture they were reading, not over whatever replaces it.
   */
  judgeAfresh(): void;
}

export function framingCamera(cosmos: Graph, host: HTMLDivElement): FramingCamera {
  /**
   * When the framing was last *judged* — advanced by every check, not only by the ones that correct, or
   * the drawing would be read back off the GPU on every frame it happens to be framed correctly. Starts
   * at the mount, whose `fitViewOnInit` has just framed the seed ring.
   */
  let checkedAt = performance.now();
  let ceded = false;

  return {
    keepFramed() {
      if (ceded) return;
      const now = performance.now();
      if (now - checkedAt < REFRAME_CHECK_MS) return;
      checkedAt = now;
      if (misframed(cosmos, host)) cosmos.fitView(REFRAME_GLIDE_MS, REFRAME_PADDING);
    },
    fitNow: () => cosmos.fitView(0, REFRAME_PADDING),
    cedeToReader: () => (ceded = true),
    judgeAfresh() {
      ceded = false;
      checkedAt = performance.now();
    },
  };
}

/**
 * Where the camera sits, in the space units the simulation and the label grid share — so the answer is
 * independent of zoom.
 */
export function currentView(cosmos: Graph, host: HTMLDivElement): LabelView {
  // Space y runs opposite screen y, so the corners are ordered rather than assigned.
  const [ax, ay] = cosmos.screenToSpacePosition([0, 0]);
  const [bx, by] = cosmos.screenToSpacePosition([host.clientWidth, host.clientHeight]);
  return {
    scale: spaceScale(cosmos),
    minX: Math.min(ax, bx),
    maxX: Math.max(ax, bx),
    minY: Math.min(ay, by),
    maxY: Math.max(ay, by),
  };
}

/**
 * Screen pixels per unit of graph space, read off the transform rather than `getZoomLevel`, which is
 * relative to the initial fit and so does not answer "how big is a space unit right now".
 */
export function spaceScale(cosmos: Graph): number {
  const [originX] = cosmos.spaceToScreenPosition([0, 0]);
  const [unitX] = cosmos.spaceToScreenPosition([1, 0]);
  return unitX - originX;
}

/**
 * Whether the drawing needs re-framing: it has left the viewport, or contracted into less than
 * {@link REFRAME_MIN_COVERAGE} of it.
 *
 * A degenerate extent (every point at one spot, before the layout has spread) reads as uncovered, which
 * is harmless: fitting a box the camera already holds glides nowhere.
 */
function misframed(cosmos: Graph, host: HTMLDivElement): boolean {
  const points = cosmos.getPointPositions();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < points.length; i += 2) {
    minX = Math.min(minX, points[i]);
    maxX = Math.max(maxX, points[i]);
    minY = Math.min(minY, points[i + 1]);
    maxY = Math.max(maxY, points[i + 1]);
  }
  if (!Number.isFinite(minX)) return false; // Nothing drawn yet — nothing to frame.

  const view = currentView(cosmos, host);
  if (minX < view.minX || maxX > view.maxX || minY < view.minY || maxY > view.maxY) return true;
  // Coverage on the *larger* dimension, so a wide, flat layout is not re-fitted forever for the slack
  // above and below it that no framing can remove.
  const coverage = Math.max((maxX - minX) / (view.maxX - view.minX), (maxY - minY) / (view.maxY - view.minY));
  return coverage < REFRAME_MIN_COVERAGE;
}
