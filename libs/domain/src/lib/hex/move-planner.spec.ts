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
  return { hexes: [coord], regions: [] };
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

    expect(plan).toEqual({ blocked: false, hexes: [], regions: [] });
  });

  it('resolves to an empty no-op plan when nothing is selected', () => {
    const doc = docWith({ '0,0': { terrain: 'forest' } });

    const plan = planMove({
      document: doc,
      selection: { hexes: [], regions: [] },
      offset: { q: 1, r: 0 },
    });

    expect(plan).toEqual({ blocked: false, hexes: [], regions: [] });
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
      regions: [],
    });
  });
});

describe('planMove — group rigid translation onto Void', () => {
  it('moves every selected hex by the one offset, keeping the cluster shape', () => {
    // Two painted hexes picked together; a clear destination region (Void). Each
    // selected source is snapshotted, its origin cleared, and its whole record
    // written at source + offset — the rigid translation that keeps the internal
    // shape (CONTEXT.md → "a group move is a rigid translation by one offset").
    const a = { q: 0, r: 0 };
    const b = { q: 1, r: 0 };
    const doc = docWith({
      [coordKey(a)]: { terrain: 'forest' },
      [coordKey(b)]: { terrain: 'ocean' },
    });

    const plan = planMove({
      document: doc,
      selection: { hexes: [a, b], regions: [] },
      offset: { q: 0, r: 2 },
    });

    // Destinations are written in selection order, then the origins that nothing
    // reclaimed are cleared — so the plan reads top-down as "place, place, clear".
    expect(plan).toEqual({
      blocked: false,
      hexes: [
        { coord: { q: 0, r: 2 }, hex: { terrain: 'forest' } },
        { coord: { q: 1, r: 2 }, hex: { terrain: 'ocean' } },
        { coord: a, hex: null },
        { coord: b, hex: null },
      ],
      regions: [],
    });
  });
});

describe('planMove — intra-group overlap (shift-by-one)', () => {
  it('shifts a blob by one cell without fighting itself: the vacated tail clears, the rest is reclaimed', () => {
    // A,B are a contiguous pair; nudging right by one lands A on B's old cell. That
    // is the group shifting onto its own path, not a collision — B's source is a
    // group destination, so it is written (not cleared), and only the tail (0,0)
    // that nothing reclaims goes back to Void.
    const a = { q: 0, r: 0 };
    const b = { q: 1, r: 0 };
    const doc = docWith({
      [coordKey(a)]: { terrain: 'forest' },
      [coordKey(b)]: { terrain: 'ocean' },
    });

    const plan = planMove({
      document: doc,
      selection: { hexes: [a, b], regions: [] },
      offset: { q: 1, r: 0 },
    });

    expect(plan).toEqual({
      blocked: false,
      hexes: [
        { coord: { q: 1, r: 0 }, hex: { terrain: 'forest' } },
        { coord: { q: 2, r: 0 }, hex: { terrain: 'ocean' } },
        { coord: a, hex: null },
      ],
      regions: [],
    });
  });
});

describe('planMove — group collision swaps a non-selected occupant', () => {
  it('displaces the occupant to d − offset when that cell is free', () => {
    // A two-hex group lands on a non-selected occupant at one destination. The
    // occupant is pushed back by the inverse offset to a free cell — here a source
    // the group is vacating — so the drop stays non-destructive (CONTEXT.md →
    // "a destination occupied by a non-selected hex swaps that occupant back").
    const a = { q: 0, r: 0 };
    const b = { q: 0, r: 1 };
    const occupant = { q: 3, r: 0 };
    const doc = docWith({
      [coordKey(a)]: { terrain: 'forest' },
      [coordKey(b)]: { terrain: 'grass' },
      [coordKey(occupant)]: { terrain: 'ocean', name: 'The Deep' },
    });

    const plan = planMove({
      document: doc,
      selection: { hexes: [a, b], regions: [] },
      offset: { q: 3, r: 0 },
    });

    expect(plan).toEqual({
      blocked: false,
      hexes: [
        { coord: { q: 3, r: 0 }, hex: { terrain: 'forest' } },
        { coord: { q: 3, r: 1 }, hex: { terrain: 'grass' } },
        // The occupant swaps to d − offset = (0,0), a source the group vacates.
        { coord: { q: 0, r: 0 }, hex: { terrain: 'ocean', name: 'The Deep' } },
        // (0,1) is the only source nothing reclaimed, so only it clears.
        { coord: { q: 0, r: 1 }, hex: null },
      ],
      regions: [],
    });
  });
});

describe('planMove — self-overlap blocks the contested cell', () => {
  it('blocks a destination whose occupant can only go where the group is landing', () => {
    // A,B nudge right by one. B lands on a non-selected occupant X at (2,0); pushing
    // X back by the inverse offset targets (1,0) — but that is exactly where A is
    // landing. The geometry is ambiguous, so the cell blocks (CONTEXT.md →
    // "where d − offset is occupied by the moving group, that cell is blocked").
    const a = { q: 0, r: 0 };
    const b = { q: 1, r: 0 };
    const x = { q: 2, r: 0 };
    const doc = docWith({
      [coordKey(a)]: { terrain: 'forest' },
      [coordKey(b)]: { terrain: 'ocean' },
      [coordKey(x)]: { terrain: 'mountain' },
    });

    const plan = planMove({
      document: doc,
      selection: { hexes: [a, b], regions: [] },
      offset: { q: 1, r: 0 },
    });

    expect(plan).toEqual({ blocked: true, cells: [{ q: 2, r: 0 }] });
  });
});

describe('planMove — any blocked cell blocks the whole move', () => {
  it('refuses the entire move — no writes — even when other members would resolve cleanly', () => {
    // A far-flung member C would translate onto Void cleanly, but B's nudge into X
    // blocks. One blocked cell refuses the whole move: the result is the refusal,
    // never a partial plan that moves C while abandoning B.
    const a = { q: 0, r: 0 };
    const b = { q: 1, r: 0 };
    const c = { q: 10, r: 0 };
    const x = { q: 2, r: 0 };
    const doc = docWith({
      [coordKey(a)]: { terrain: 'forest' },
      [coordKey(b)]: { terrain: 'ocean' },
      [coordKey(c)]: { terrain: 'grass' },
      [coordKey(x)]: { terrain: 'mountain' },
    });

    const plan = planMove({
      document: doc,
      selection: { hexes: [a, b, c], regions: [] },
      offset: { q: 1, r: 0 },
    });

    expect(plan).toEqual({ blocked: true, cells: [{ q: 2, r: 0 }] });
  });
});

describe('planMove — region footprint translation', () => {
  it('shifts every member of a selected region by the offset, leaving hexes untouched', () => {
    // A region selected with no hexes: its whole membership footprint translates by
    // the offset, and nothing else moves (CONTEXT.md → "each selected Region's
    // membership footprint shifts by the offset").
    const doc: HexMap = {
      hexes: {},
      regions: [
        {
          id: 'r1',
          name: 'Avalon',
          color: '#b08a4e',
          hexes: { '0,0': true, '1,0': true },
        },
      ],
      labels: [],
    };

    const plan = planMove({
      document: doc,
      selection: { hexes: [], regions: ['r1'] },
      offset: { q: 0, r: 3 },
    });

    expect(plan).toEqual({
      blocked: false,
      hexes: [],
      regions: [{ id: 'r1', hexes: { '0,3': true, '1,3': true } }],
    });
  });
});

describe('planMove — mixed selection', () => {
  it('translates hexes and a region footprint together by the same offset', () => {
    // A hex and a region picked together translate by the same offset. Labels are
    // not the planner's concern at all — they are free-positioned pixels that never
    // collide, so the MoveSelection it reads carries no labels (the caller nudges
    // them by the equivalent pixels).
    const a = { q: 0, r: 0 };
    const doc: HexMap = {
      hexes: { [coordKey(a)]: { terrain: 'forest' } },
      regions: [
        {
          id: 'r1',
          name: 'Avalon',
          color: '#b08a4e',
          hexes: { '0,0': true, '2,0': true },
        },
      ],
      labels: [],
    };

    const plan = planMove({
      document: doc,
      selection: { hexes: [a], regions: ['r1'] },
      offset: { q: 0, r: 1 },
    });

    expect(plan).toEqual({
      blocked: false,
      hexes: [
        { coord: { q: 0, r: 1 }, hex: { terrain: 'forest' } },
        { coord: a, hex: null },
      ],
      regions: [{ id: 'r1', hexes: { '0,1': true, '2,1': true } }],
    });
  });
});
