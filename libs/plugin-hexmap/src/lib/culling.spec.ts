import { hexesInRect } from './culling';
import { hexToPixel, Layout } from './layout';

const layout: Layout = {
  orientation: 'pointy',
  size: { x: 10, y: 10 },
  origin: { x: 0, y: 0 },
};

describe('hexesInRect', () => {
  it('includes the hex at the centre of the rect', () => {
    const c = hexToPixel(layout, { q: 2, r: 1 });
    const rect = { minX: c.x - 1, minY: c.y - 1, maxX: c.x + 1, maxY: c.y + 1 };

    expect(hexesInRect(layout, rect)).toContainEqual({ q: 2, r: 1 });
  });

  it('culls hexes far outside the rect', () => {
    const hexes = hexesInRect(layout, {
      minX: -5,
      minY: -5,
      maxX: 5,
      maxY: 5,
    });

    expect(hexes).toContainEqual({ q: 0, r: 0 });
    expect(hexes).not.toContainEqual({ q: 50, r: 50 });
  });

  it('returns a bounded count scaling with the viewport, not the plane', () => {
    const hexes = hexesInRect(layout, {
      minX: 0,
      minY: 0,
      maxX: 100,
      maxY: 100,
    });

    // ~10x10 px hexes over a 100x100 px viewport: dozens, not thousands.
    expect(hexes.length).toBeGreaterThan(0);
    expect(hexes.length).toBeLessThan(200);
  });
});
