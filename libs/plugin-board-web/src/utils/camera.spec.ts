import { Camera, fitCamera } from './camera';

describe('Camera', () => {
  it('maps world to screen 1:1 at the initial transform', () => {
    const cam = Camera.initial();

    expect(cam.worldToScreen({ x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
  });

  it('shifts the view by the drag delta when panned', () => {
    const cam = Camera.initial().panBy(15, -5);

    expect(cam.worldToScreen({ x: 0, y: 0 })).toEqual({ x: 15, y: -5 });
  });

  it('converts screen back to world, inverting pan and zoom', () => {
    const cam = Camera.initial().panBy(15, -5);
    const world = { x: 7, y: 3 };

    expect(cam.screenToWorld(cam.worldToScreen(world))).toEqual(world);
  });

  it('scales by the zoom factor', () => {
    expect(Camera.initial().zoomAt({ x: 0, y: 0 }, 2).zoom).toBe(2);
  });

  it('keeps the point under the cursor fixed while zooming', () => {
    const cursor = { x: 50, y: 40 };
    const anchored = Camera.initial().screenToWorld(cursor);

    const zoomed = Camera.initial().zoomAt(cursor, 2);

    // The world point that was under the cursor is still under the cursor.
    expect(zoomed.worldToScreen(anchored)).toEqual(cursor);
  });

  it('lands exactly on a target zoom via zoomTo, not a factor approximation of it', () => {
    // A repeated ×1.15 step drifts in float space; zoomTo takes the scale outright.
    const cam = Camera.initial().zoomAt({ x: 10, y: 10 }, 1.1500001);

    expect(cam.zoomTo({ x: 30, y: 20 }, 4).zoom).toBe(4);
  });

  it('keeps the point under the anchor fixed through zoomTo', () => {
    const anchor = { x: 80, y: 25 };
    const cam = Camera.initial().panBy(12, -7).zoomAt({ x: 3, y: 4 }, 1.4);
    const anchored = cam.screenToWorld(anchor);

    const snapped = cam.zoomTo(anchor, 2.5);

    expect(snapped.worldToScreen(anchored).x).toBeCloseTo(anchor.x, 10);
    expect(snapped.worldToScreen(anchored).y).toBeCloseTo(anchor.y, 10);
  });
});

describe('fitCamera', () => {
  const bounds = { padding: 64, minZoom: 0.25, maxZoom: 1 };

  it('has nothing to frame on an empty board', () => {
    expect(fitCamera([], { width: 800, height: 600 }, bounds)).toBeNull();
  });

  it('centres the content bounding box in the viewport', () => {
    const elements = [{ position: { x: 1000, y: -500 }, size: { width: 200, height: 100 } }];

    const cam = fitCamera(elements, { width: 800, height: 600 }, bounds);

    // The far-flung element's centre lands on the viewport centre — the old reset-to-origin lost it.
    expect(cam?.worldToScreen({ x: 1100, y: -450 })).toEqual({ x: 400, y: 300 });
  });

  it('caps the zoom at maxZoom, so one small element does not blow the view up', () => {
    const elements = [{ position: { x: 0, y: 0 }, size: { width: 10, height: 10 } }];

    const cam = fitCamera(elements, { width: 800, height: 600 }, bounds);

    expect(cam?.zoom).toBe(1);
  });

  it('zooms out to fit sprawling content, leaving the screen padding on the tight axis', () => {
    // 1344 world px wide in an 800-wide viewport: (800 - 2·64) / 1344 = 0.5.
    const elements = [
      { position: { x: 0, y: 0 }, size: { width: 100, height: 100 } },
      { position: { x: 1244, y: 200 }, size: { width: 100, height: 100 } },
    ];

    const cam = fitCamera(elements, { width: 800, height: 600 }, bounds);

    expect(cam?.zoom).toBe(0.5);
    // Padding on the tight (x) axis: the bbox's left edge sits exactly 64 screen px in.
    expect(cam?.worldToScreen({ x: 0, y: 0 }).x).toBe(64);
    expect(cam?.worldToScreen({ x: 1344, y: 0 }).x).toBe(800 - 64);
  });

  it('clamps at minZoom when the content outruns even the fit', () => {
    const elements = [{ position: { x: 0, y: 0 }, size: { width: 100000, height: 100 } }];

    const cam = fitCamera(elements, { width: 800, height: 600 }, bounds);

    expect(cam?.zoom).toBe(0.25);
  });
});
