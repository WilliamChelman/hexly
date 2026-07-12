import { neighbors } from './coordinates';
import { edgeId, vertexId } from './edges';

describe('edgeId', () => {
  it('is identical from both hexes that share the edge', () => {
    const a = { q: 0, r: 0 };
    const acrossDir0 = neighbors(a)[0];

    // The edge is direction 0 from `a` and the opposite direction (3) from its
    // neighbour — both must name the same edge.
    expect(edgeId(a, 0)).toBe(edgeId(acrossDir0, 3));
  });

  it('distinguishes the different edges of one hex', () => {
    const a = { q: 0, r: 0 };

    expect(edgeId(a, 0)).not.toBe(edgeId(a, 1));
  });
});

describe('vertexId', () => {
  it('is identical from all three hexes that meet at the vertex', () => {
    const a = { q: 0, r: 0 };
    const [dir0, dir1] = neighbors(a);

    // Corner 0 of `a` is shared with its dir-0 and dir-1 neighbours; the same
    // vertex is corner 2 of the first and corner 4 of the second.
    expect(vertexId(a, 0)).toBe(vertexId(dir0, 2));
    expect(vertexId(a, 0)).toBe(vertexId(dir1, 4));
  });

  it('distinguishes the different vertices of one hex', () => {
    const a = { q: 0, r: 0 };

    expect(vertexId(a, 0)).not.toBe(vertexId(a, 1));
  });
});
