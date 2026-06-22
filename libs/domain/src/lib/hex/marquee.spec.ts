import { hexToPixel, Layout } from './layout';
import { marqueeHits } from './marquee';
import { emptyHexMap, HexMap } from './hex-map';

const layout: Layout = {
  orientation: 'pointy',
  size: { x: 10, y: 10 },
  origin: { x: 0, y: 0 },
};

/** A tiny world rect centred on a hex's pixel centre, so the centre is inside it. */
function rectAround(hex: { q: number; r: number }) {
  const c = hexToPixel(layout, hex);
  return { minX: c.x - 1, minY: c.y - 1, maxX: c.x + 1, maxY: c.y + 1 };
}

describe('marqueeHits', () => {
  it('returns a painted hex whose centre falls inside the rect', () => {
    const doc: HexMap = { ...emptyHexMap(), hexes: { '2,1': { terrain: 'forest' } } };

    const hits = marqueeHits(layout, doc, rectAround({ q: 2, r: 1 }));

    expect(hits.hexes).toContainEqual({ q: 2, r: 1 });
  });

  it('excludes a painted hex whose centre falls outside the rect', () => {
    const doc: HexMap = {
      ...emptyHexMap(),
      hexes: { '2,1': { terrain: 'forest' }, '9,9': { terrain: 'ocean' } },
    };

    const hits = marqueeHits(layout, doc, rectAround({ q: 2, r: 1 }));

    expect(hits.hexes).toContainEqual({ q: 2, r: 1 });
    expect(hits.hexes).not.toContainEqual({ q: 9, r: 9 });
  });

  it('returns the ids of labels whose anchor falls inside, and excludes the rest', () => {
    const doc: HexMap = {
      ...emptyHexMap(),
      labels: [
        { id: 'in', text: 'A', position: { x: 5, y: 5 }, size: 28 },
        { id: 'out', text: 'B', position: { x: 500, y: 500 }, size: 28 },
      ],
    };

    const hits = marqueeHits(layout, doc, { minX: 0, minY: 0, maxX: 10, maxY: 10 });

    expect(hits.labels).toEqual(['in']);
  });

  it('never returns a coordinate that is only a region member (Regions are not marquee-selectable)', () => {
    // A Region whose membership covers (2,1), but no Hex is painted there: the
    // marquee keys off painted hexes, never region membership, so it finds nothing.
    const doc: HexMap = {
      ...emptyHexMap(),
      regions: [
        { id: 'kingdom', name: 'K', color: '#7c9b86', hexes: { '2,1': true } },
      ],
    };

    const hits = marqueeHits(layout, doc, rectAround({ q: 2, r: 1 }));

    expect(hits.hexes).toEqual([]);
    expect(hits).not.toHaveProperty('regions');
  });
});
