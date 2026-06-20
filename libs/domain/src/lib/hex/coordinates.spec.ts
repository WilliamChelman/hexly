import {
  axialToCube,
  cubeToAxial,
  distance,
  hexRound,
  neighbors,
} from './coordinates';

describe('axialToCube', () => {
  it('maps axial (q,r) onto a cube whose components sum to zero', () => {
    const cube = axialToCube({ q: 1, r: 2 });

    expect(cube).toEqual({ x: 1, y: -3, z: 2 });
    expect(cube.x + cube.y + cube.z).toBe(0);
  });
});

describe('cubeToAxial', () => {
  it('inverts axialToCube', () => {
    const axial = { q: -3, r: 5 };

    expect(cubeToAxial(axialToCube(axial))).toEqual(axial);
  });
});

describe('hexRound', () => {
  it('rounds a fractional axial to the nearest hex', () => {
    expect(hexRound({ q: 0.2, r: -0.1 })).toEqual({ q: 0, r: 0 });
    expect(hexRound({ q: 1.8, r: 0.1 })).toEqual({ q: 2, r: 0 });
  });
});

describe('neighbors', () => {
  it('returns the six hexes adjacent to the given one', () => {
    const result = neighbors({ q: 0, r: 0 });

    expect(result).toEqual([
      { q: 1, r: 0 },
      { q: 1, r: -1 },
      { q: 0, r: -1 },
      { q: -1, r: 0 },
      { q: -1, r: 1 },
      { q: 0, r: 1 },
    ]);
  });

  it('translates the neighbour ring to the hex being asked about', () => {
    expect(neighbors({ q: 3, r: -2 })).toContainEqual({ q: 4, r: -2 });
  });
});

describe('distance', () => {
  it('counts a single step between adjacent hexes', () => {
    expect(distance({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(1);
  });

  it('measures the fewest steps between two hexes', () => {
    expect(distance({ q: 0, r: 0 }, { q: 3, r: -1 })).toBe(3);
  });
});
