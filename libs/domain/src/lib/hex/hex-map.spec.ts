import {
  coordKey,
  emptyHexMap,
  featureLibrary,
  hexMapSchema,
  parseCoordKey,
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

    expect(hexMapSchema.parse(doc)).toEqual(doc);
  });

  it('rejects a hex whose terrain is not a known palette id', () => {
    const doc = { hexes: { '0,0': { terrain: 'lava' } } };

    expect(() => hexMapSchema.parse(doc)).toThrow();
  });

  it('round-trips a hex that carries a feature referenced by id', () => {
    const doc = {
      hexes: { '0,0': { terrain: 'forest', feature: { ref: 'settlement' } } },
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
