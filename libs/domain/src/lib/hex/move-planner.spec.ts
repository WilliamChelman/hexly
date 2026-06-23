import { describe, expect, it } from 'vitest';
import { Axial } from './coordinates';
import { coordKey, Hex, HexMap } from './hex-map';
import { planMove } from './move-planner';

/** A document holding just the given painted hexes; no regions or labels. */
function docWith(hexes: Record<string, Hex>): HexMap {
  return { hexes, regions: [], labels: [] };
}

/** A selection of a single hex coordinate (no labels or regions). */
function pickHex(coord: Axial) {
  return { hexes: [coord], labels: [], regions: [] };
}

describe('planMove — single hex onto Void', () => {
  it('writes the moved record at the destination and clears the origin', () => {
    const from = { q: 0, r: 0 };
    const to = { q: 2, r: -1 };
    const doc = docWith({ [coordKey(from)]: { terrain: 'forest' } });

    const plan = planMove({
      document: doc,
      selection: pickHex(from),
      offset: { q: 2, r: -1 },
    });

    expect(plan).toEqual({
      blocked: false,
      hexes: [
        { coord: to, hex: { terrain: 'forest' } },
        { coord: from, hex: null },
      ],
      labels: [],
      regions: [],
    });
  });
});

describe('planMove — single hex onto Void carries the whole record', () => {
  it('moves terrain, feature, and name together to the destination', () => {
    const from = { q: 0, r: 0 };
    const fromHex: Hex = {
      terrain: 'mountain',
      feature: { ref: 'ruin' },
      name: 'The Crossing',
    };
    const doc = docWith({ [coordKey(from)]: fromHex });

    const plan = planMove({
      document: doc,
      selection: pickHex(from),
      offset: { q: 0, r: 2 },
    });

    expect(plan).toEqual({
      blocked: false,
      hexes: [
        { coord: { q: 0, r: 2 }, hex: fromHex },
        { coord: from, hex: null },
      ],
      labels: [],
      regions: [],
    });
  });

  it('leaves the input document untouched (the plan is a description, not a mutation)', () => {
    const from = { q: 0, r: 0 };
    const to = { q: 1, r: 0 };
    const doc = docWith({
      [coordKey(from)]: { terrain: 'forest', name: 'Riverbend' },
      [coordKey(to)]: { terrain: 'ocean' },
    });
    const before = structuredClone(doc);

    planMove({ document: doc, selection: pickHex(from), offset: { q: 1, r: 0 } });

    expect(doc).toEqual(before);
  });
});

describe('planMove — single hex onto an occupied hex', () => {
  it('swaps the two whole records, carrying terrain, feature, and name both ways', () => {
    const from = { q: 0, r: 0 };
    const to = { q: 1, r: 0 };
    const fromHex: Hex = {
      terrain: 'forest',
      feature: { ref: 'settlement' },
      name: 'Riverbend',
    };
    const toHex: Hex = { terrain: 'ocean', name: 'The Deep' };
    const doc = docWith({ [coordKey(from)]: fromHex, [coordKey(to)]: toHex });

    const plan = planMove({
      document: doc,
      selection: pickHex(from),
      offset: { q: 1, r: 0 },
    });

    expect(plan).toEqual({
      blocked: false,
      hexes: [
        { coord: to, hex: fromHex },
        { coord: from, hex: toHex },
      ],
      labels: [],
      regions: [],
    });
  });
});

describe('planMove — carries nothing', () => {
  it('resolves to an empty no-op plan when the origin is Void', () => {
    // The origin coordinate is unpainted: there is nothing to carry. The plan must
    // be empty rather than emitting a clear at the destination, which would destroy
    // the occupant the move never touched.
    const doc = docWith({ '1,0': { terrain: 'ocean' } });

    const plan = planMove({
      document: doc,
      selection: pickHex({ q: 0, r: 0 }),
      offset: { q: 1, r: 0 },
    });

    expect(plan).toEqual({ blocked: false, hexes: [], labels: [], regions: [] });
  });

  it('resolves to an empty no-op plan when nothing is selected', () => {
    const doc = docWith({ '0,0': { terrain: 'forest' } });

    const plan = planMove({
      document: doc,
      selection: { hexes: [], labels: [], regions: [] },
      offset: { q: 1, r: 0 },
    });

    expect(plan).toEqual({ blocked: false, hexes: [], labels: [], regions: [] });
  });
});

describe('planMove — regions stay put', () => {
  it('shifts no region footprint when the moved hex is a member but no region is selected', () => {
    const from = { q: 0, r: 0 };
    const doc: HexMap = {
      hexes: { [coordKey(from)]: { terrain: 'forest' } },
      regions: [
        { id: 'r1', name: 'Avalon', color: '#b08a4e', hexes: { '0,0': true } },
      ],
      labels: [],
    };

    const plan = planMove({
      document: doc,
      selection: pickHex(from),
      offset: { q: 3, r: 0 },
    });

    // The boundary stays where it was drawn while content slides under it: the
    // member set is untouched because the move carries no region.
    expect(plan).toEqual({
      blocked: false,
      hexes: [
        { coord: { q: 3, r: 0 }, hex: { terrain: 'forest' } },
        { coord: from, hex: null },
      ],
      labels: [],
      regions: [],
    });
  });
});
