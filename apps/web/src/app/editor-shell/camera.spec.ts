import { Camera } from './camera';

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
});
