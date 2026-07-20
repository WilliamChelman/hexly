import { BoardCamera, MAX_ZOOM, MIN_ZOOM } from './board-camera';

describe('BoardCamera', () => {
  const anchor = { x: 100, y: 80 };

  it('zooms by the factor about the anchor within the bounds', () => {
    const cam = new BoardCamera();
    const anchored = cam.screenToWorld(anchor);

    cam.zoomAround(anchor, 2);

    expect(cam.zoom()).toBe(2);
    expect(cam.worldToScreen(anchored)).toEqual(anchor);
  });

  it('clamps an overshooting step onto MAX_ZOOM instead of discarding it', () => {
    const cam = new BoardCamera();

    // Ten ×1.15 presses from 100%: the tenth overshoots 4 and used to be rejected, stranding ~352%.
    for (let i = 0; i < 10; i++) cam.zoomAround(anchor, 1.15);

    expect(cam.zoom()).toBe(MAX_ZOOM);
  });

  it('clamps zooming out onto MIN_ZOOM', () => {
    const cam = new BoardCamera();

    for (let i = 0; i < 12; i++) cam.zoomAround(anchor, 1 / 1.15);

    expect(cam.zoom()).toBe(MIN_ZOOM);
  });

  it('keeps the world point under the anchor fixed even when the step is clamped', () => {
    const cam = new BoardCamera();
    cam.panBy(37, -12);
    cam.zoomAround(anchor, 3.5);
    const anchored = cam.screenToWorld(anchor);

    cam.zoomAround(anchor, 2); // 7 → clamped to 4, re-anchored.

    expect(cam.zoom()).toBe(MAX_ZOOM);
    expect(cam.worldToScreen(anchored).x).toBeCloseTo(anchor.x, 10);
    expect(cam.worldToScreen(anchored).y).toBeCloseTo(anchor.y, 10);
  });

  it('rejects a non-finite or non-positive factor — NaN passes a < comparison and corrupts for good', () => {
    const cam = new BoardCamera();
    const before = cam.camera();

    cam.zoomAround(anchor, Number.NaN);
    cam.zoomAround(anchor, Infinity);
    cam.zoomAround(anchor, 0);
    cam.zoomAround(anchor, -2);

    expect(cam.camera()).toBe(before);
  });

  it('rejects a non-finite anchor', () => {
    const cam = new BoardCamera();
    const before = cam.camera();

    cam.zoomAround({ x: Number.NaN, y: 0 }, 1.15);
    cam.zoomAround({ x: 0, y: Infinity }, 1.15);

    expect(cam.camera()).toBe(before);
  });
});
