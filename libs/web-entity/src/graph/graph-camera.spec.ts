import type { Graph } from '@cosmos.gl/graph';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { framingCamera } from './graph-camera';

/** The check cadence the camera is built on — kept here so the spec fails loudly if it moves. */
const CHECK_MS = 700;

describe('framingCamera', () => {
  let now = 0;

  /**
   * A graph whose transform maps the 100×100 host onto the space box 0..100 (y flipped, as cosmos's
   * does), so `points` can be written straight in viewport terms.
   */
  const fakeGraph = (points: number[]) =>
    ({
      getPointPositions: vi.fn(() => points),
      screenToSpacePosition: ([x, y]: [number, number]) => [x, 100 - y],
      spaceToScreenPosition: ([x, y]: [number, number]) => [x, 100 - y],
      fitView: vi.fn(),
    }) as unknown as Graph;

  const host = { clientWidth: 100, clientHeight: 100 } as HTMLDivElement;
  /** A drawing filling most of the viewport — correctly framed, so no correction is ever due. */
  const framed = [10, 10, 90, 90];
  /** A drawing contracted into a fifth of the viewport — under the coverage floor. */
  const contracted = [40, 40, 60, 60];

  beforeEach(() => {
    now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
  });

  afterEach(() => vi.restoreAllMocks());

  it('does not read the drawing before its check window is up', () => {
    const graph = fakeGraph(framed);
    const camera = framingCamera(graph, host);

    for (let frame = 0; frame < 40; frame++) {
      now += 16;
      camera.keepFramed();
    }

    expect(graph.getPointPositions).not.toHaveBeenCalled();
  });

  it('judges once per window, however many frames go by, and holds still while the framing is right', () => {
    const graph = fakeGraph(framed);
    const camera = framingCamera(graph, host);

    // Two full windows' worth of 60 Hz ticks.
    for (let frame = 0; frame < 2 * Math.ceil(CHECK_MS / 16); frame++) {
      now += 16;
      camera.keepFramed();
    }

    expect(graph.getPointPositions).toHaveBeenCalledTimes(2);
    expect(graph.fitView).not.toHaveBeenCalled();
  });

  it('corrects a drawing that has contracted, once per window', () => {
    const graph = fakeGraph(contracted);
    const camera = framingCamera(graph, host);

    now += CHECK_MS;
    camera.keepFramed();
    camera.keepFramed();

    expect(graph.fitView).toHaveBeenCalledTimes(1);
  });

  it('stops judging for good once the reader takes the camera', () => {
    const graph = fakeGraph(contracted);
    const camera = framingCamera(graph, host);

    camera.cedeToReader();
    now += CHECK_MS * 10;
    camera.keepFramed();

    expect(graph.getPointPositions).not.toHaveBeenCalled();
    expect(graph.fitView).not.toHaveBeenCalled();
  });
});
