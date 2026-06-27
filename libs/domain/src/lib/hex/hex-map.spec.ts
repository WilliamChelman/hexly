import {
  coordKey,
  emptyHexMap,
  featureLibrary,
  hexMapSchema,
  labelSchema,
  parseCoordKey,
  regionSchema,
  terrainPalette,
} from './hex-map';

describe('terrainPalette', () => {
  it('offers the built-in terrains with stable ids and display labels', () => {
    const byId = new Map(terrainPalette.map((t) => [t.id, t.label]));

    expect(byId.get('grass')).toBe('Grassland');
    expect(byId.get('forest')).toBe('Forest');
    expect(byId.get('ocean')).toBe('Ocean');
    expect(byId.get('mountain')).toBe('Mountains');
    expect(byId.get('desert')).toBe('Desert');
  });
});

describe('featureLibrary', () => {
  it('offers the built-in features with stable ids and display labels', () => {
    const byId = new Map(featureLibrary.map((f) => [f.id, f.label]));

    expect(byId.get('settlement')).toBe('Settlement');
    expect(byId.get('ruin')).toBe('Ruin');
  });
});

describe('regionSchema', () => {
  it('round-trips a named, colored region that owns a set of coordinates', () => {
    const region = {
      id: 'r1',
      name: 'The Whisperwood',
      color: '#7c9b86',
      hexes: { '0,0': true, '1,-1': true },
    };

    expect(regionSchema.parse(region)).toEqual(region);
  });

  it('round-trips a region that carries an Entity Link by id', () => {
    const region = {
      id: 'r1',
      name: 'The Whisperwood',
      color: '#7c9b86',
      hexes: { '0,0': true },
      entityId: 'ent-3',
    };

    expect(regionSchema.parse(region)).toEqual(region);
  });
});

describe('labelSchema', () => {
  it('round-trips a free-positioned label with text, size and rotation', () => {
    const label = {
      id: 'l1',
      text: 'The Whisperwood',
      position: { x: 120, y: -40 },
      size: 28,
      rotation: 15,
    };

    expect(labelSchema.parse(label)).toEqual(label);
  });

  it('accepts a label with no rotation (an unrotated label)', () => {
    const label = { id: 'l2', text: 'Open Sea', position: { x: 0, y: 0 }, size: 32 };

    expect(labelSchema.parse(label)).toEqual(label);
  });

  it('rejects a label whose size is not positive', () => {
    const label = { id: 'l3', text: 'x', position: { x: 0, y: 0 }, size: 0 };

    expect(() => labelSchema.parse(label)).toThrow();
  });
});

describe('coordKey', () => {
  it('round-trips an axial coordinate through its document key', () => {
    const coord = { q: 3, r: -2 };

    expect(parseCoordKey(coordKey(coord))).toEqual(coord);
  });
});

describe('hexMapSchema', () => {
  it('accepts a fresh map that has no hexes (the plane starts all Void)', () => {
    const fresh = emptyHexMap();

    expect(hexMapSchema.parse(fresh).hexes).toEqual({});
  });

  it('round-trips painted hexes that reference terrain by id', () => {
    const doc = {
      hexes: {
        [coordKey({ q: 0, r: 0 })]: { terrain: 'forest' },
        [coordKey({ q: 1, r: -2 })]: { terrain: 'ocean' },
      },
    };

    expect(hexMapSchema.parse(doc)).toEqual({ ...doc, regions: [], labels: [] });
  });

  it('defaults regions to empty for a document saved before regions existed', () => {
    const legacy = { hexes: { '0,0': { terrain: 'grass' } } };

    expect(hexMapSchema.parse(legacy).regions).toEqual([]);
  });

  it('round-trips regions, with one coordinate owned by two regions at once', () => {
    const doc = {
      hexes: {},
      regions: [
        { id: 'a', name: 'Avalon', color: '#b08a4e', hexes: { '0,0': true } },
        { id: 'b', name: 'Whisperwood', color: '#7c9b86', hexes: { '0,0': true } },
      ],
    };

    expect(hexMapSchema.parse(doc)).toEqual({ ...doc, labels: [] });
  });

  it('rejects a region whose color is not a #rrggbb hex color', () => {
    const doc = {
      hexes: {},
      regions: [{ id: 'a', name: 'Avalon', color: 'red', hexes: {} }],
    };

    expect(() => hexMapSchema.parse(doc)).toThrow();
  });

  it('rejects a hex whose terrain is not a known palette id', () => {
    const doc = { hexes: { '0,0': { terrain: 'lava' } } };

    expect(() => hexMapSchema.parse(doc)).toThrow();
  });

  it('round-trips a hex that carries a feature referenced by id', () => {
    const doc = {
      hexes: { '0,0': { terrain: 'forest', feature: { ref: 'settlement' } } },
    };

    expect(hexMapSchema.parse(doc)).toEqual({ ...doc, regions: [], labels: [] });
  });

  it('round-trips a hex that carries a name', () => {
    const doc = {
      hexes: { '0,0': { terrain: 'forest', name: 'Riverbend' } },
    };

    expect(hexMapSchema.parse(doc)).toEqual({ ...doc, regions: [], labels: [] });
  });

  it('round-trips a hex that carries an Entity Link by id', () => {
    const doc = {
      hexes: { '0,0': { terrain: 'forest', entityId: 'ent-7' } },
    };

    expect(hexMapSchema.parse(doc)).toEqual({ ...doc, regions: [], labels: [] });
  });

  it('round-trips a feature that carries its own Entity Link, distinct from the hex', () => {
    const doc = {
      hexes: {
        '0,0': { terrain: 'forest', feature: { ref: 'settlement', entityId: 'ent-9' } },
      },
    };

    expect(hexMapSchema.parse(doc)).toEqual({ ...doc, regions: [], labels: [] });
  });

  it('starts a fresh map with no regions', () => {
    expect(emptyHexMap().regions).toEqual([]);
  });

  it('defaults labels to empty for a document saved before labels existed', () => {
    const legacy = { hexes: { '0,0': { terrain: 'grass' } } };

    expect(hexMapSchema.parse(legacy).labels).toEqual([]);
  });

  it('starts a fresh map with no labels', () => {
    expect(emptyHexMap().labels).toEqual([]);
  });

  it('round-trips a free-positioned label held on the document', () => {
    const doc = {
      hexes: {},
      regions: [],
      labels: [{ id: 'l1', text: 'The Whisperwood', position: { x: 80, y: -20 }, size: 28 }],
    };

    expect(hexMapSchema.parse(doc)).toEqual(doc);
  });

  it('rejects a hex whose feature is not a known library id', () => {
    const doc = {
      hexes: { '0,0': { terrain: 'forest', feature: { ref: 'volcano' } } },
    };

    expect(() => hexMapSchema.parse(doc)).toThrow();
  });
});
