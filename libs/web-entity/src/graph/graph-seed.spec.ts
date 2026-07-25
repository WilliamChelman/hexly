import { WorldGraph } from '@hexly/domain';
import { describe, expect, it } from 'vitest';
import { graphPayload } from './graph-payload';
import { SPACE, centerPoint, positionsById, seedBuffers } from './graph-seed';

/** A World of `nodes`, linked by `edges` given as `'source>target'`. */
function world(nodes: string[], edges: string[] = []): WorldGraph {
  return {
    nodes: nodes.map((name) => ({ id: name.toLowerCase(), name, types: ['core.type.note'] })),
    edges: edges.map((edge) => {
      const [source, target] = edge.split('>');
      return { source, target, descriptor: null, decor: false };
    }),
  };
}

describe('seedBuffers', () => {
  it('seeds a fresh drawing on a ring, with the centre at the middle of the space', () => {
    const payload = graphPayload(world(['Ealdred', 'Mira'], ['ealdred>mira']));
    const center = centerPoint(payload, 'ealdred');

    const { positions, carriedOver } = seedBuffers(payload, center);

    expect(carriedOver).toBe(0);
    expect([positions[center * 2], positions[center * 2 + 1]]).toEqual([SPACE / 2, SPACE / 2]);
    const other = center === 0 ? 1 : 0;
    expect(positions[other * 2]).not.toBe(SPACE / 2);
  });

  /** The centre is the one node the reader is oriented by, so it draws larger than its degree earns it. */
  it('draws the centre larger than a leaf of the same degree', () => {
    const payload = graphPayload(world(['Ealdred', 'Mira'], ['ealdred>mira']));
    const center = centerPoint(payload, 'ealdred');

    const { sizes } = seedBuffers(payload, center);

    expect(sizes[center]).toBeGreaterThan(sizes[center === 0 ? 1 : 0]);
  });

  /**
   * The point of a data swap: an Entity that survives one keeps its place, so a depth flip or a decor
   * reveal grows the picture instead of re-scattering it. `graphPayload` re-orders by degree, so the
   * carry-over has to be by id — this World's two nodes swap indices when the third arrives.
   */
  it('carries a surviving Entity to where it already sits, whatever its new index', () => {
    const before = graphPayload(world(['Ealdred', 'Mira'], ['ealdred>mira']));
    const live = new Float32Array(before.nodes.length * 2);
    before.nodes.forEach((_, i) => {
      live[i * 2] = 100 + i;
      live[i * 2 + 1] = 200 + i;
    });
    const carried = positionsById(before.nodes, live);

    const after = graphPayload(world(['Ealdred', 'Mira', 'Thornwood'], ['ealdred>mira', 'mira>thornwood']));
    const { positions, carriedOver } = seedBuffers(after, centerPoint(after, 'ealdred'), carried);

    expect(carriedOver).toBe(2);
    for (const [id, [x, y]] of carried) {
      const index = after.nodes.findIndex((node) => node.id === id);
      expect([positions[index * 2], positions[index * 2 + 1]]).toEqual([x, y]);
    }
    // The Entity that was not there before is seeded fresh, off the ring.
    const arrived = after.nodes.findIndex((node) => node.id === 'thornwood');
    expect(positions[arrived * 2]).not.toBe(100);
  });

  /** cosmos.gl reads a NaN position as an *absent* point; carrying one would strand the node. */
  it('never carries a point whose position is not a number', () => {
    const payload = graphPayload(world(['Ealdred']));
    const carried = positionsById(payload.nodes, new Float32Array([NaN, NaN]));

    expect(carried.size).toBe(0);
    expect(seedBuffers(payload, -1, carried).carriedOver).toBe(0);
  });
});
