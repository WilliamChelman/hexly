import { hexCorners, hexToPixel, Layout, pixelToHex } from './layout';

const pointy: Layout = {
  orientation: 'pointy',
  size: { x: 10, y: 10 },
  origin: { x: 100, y: 200 },
};

const flat: Layout = {
  orientation: 'flat',
  size: { x: 10, y: 10 },
  origin: { x: 100, y: 200 },
};

describe('hexToPixel', () => {
  it('places the origin hex at the layout origin', () => {
    expect(hexToPixel(pointy, { q: 0, r: 0 })).toEqual({ x: 100, y: 200 });
  });

  it('steps a pointy-top hex east by sqrt(3) * size along +q', () => {
    const p = hexToPixel(pointy, { q: 1, r: 0 });

    expect(p.x).toBeCloseTo(100 + Math.sqrt(3) * 10, 6);
    expect(p.y).toBeCloseTo(200, 6);
  });

  it('steps a flat-top hex by a different vector for the same +q', () => {
    const p = hexToPixel(flat, { q: 1, r: 0 });

    expect(p.x).toBeCloseTo(100 + 1.5 * 10, 6);
    expect(p.y).toBeCloseTo(200 + (Math.sqrt(3) / 2) * 10, 6);
  });
});

describe('pixelToHex', () => {
  it('inverts hexToPixel for pointy-top hexes', () => {
    const hex = { q: 3, r: -2 };

    expect(pixelToHex(pointy, hexToPixel(pointy, hex))).toEqual(hex);
  });

  it('inverts hexToPixel for flat-top hexes', () => {
    const hex = { q: -4, r: 1 };

    expect(pixelToHex(flat, hexToPixel(flat, hex))).toEqual(hex);
  });

  it('snaps a pixel near a hex centre to that hex', () => {
    const centre = hexToPixel(pointy, { q: 2, r: 1 });

    expect(pixelToHex(pointy, { x: centre.x + 1, y: centre.y - 1 })).toEqual({
      q: 2,
      r: 1,
    });
  });
});

const atOrigin = (layout: Layout): Layout => ({
  ...layout,
  origin: { x: 0, y: 0 },
});

describe('hexCorners', () => {
  it('returns six corners', () => {
    expect(hexCorners(pointy, { q: 0, r: 0 })).toHaveLength(6);
  });

  it('gives a pointy-top hex a corner directly above its centre', () => {
    const corners = hexCorners(atOrigin(pointy), { q: 0, r: 0 });
    const top = corners.reduce((a, b) => (b.y < a.y ? b : a));

    expect(top.x).toBeCloseTo(0, 6);
    expect(top.y).toBeCloseTo(-10, 6);
  });

  it('gives a flat-top hex a corner directly right of its centre', () => {
    const corners = hexCorners(atOrigin(flat), { q: 0, r: 0 });
    const right = corners.reduce((a, b) => (b.x > a.x ? b : a));

    expect(right.x).toBeCloseTo(10, 6);
    expect(right.y).toBeCloseTo(0, 6);
  });
});
