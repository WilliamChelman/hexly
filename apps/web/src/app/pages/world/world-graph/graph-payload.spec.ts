import { WorldGraph } from '@hexly/domain';
import { graphPayload } from './graph-payload';

/** A World of `nodes`, linked by `edges` given as `'source>target'` or `'source-descriptor>target'`. */
function world(nodes: string[], edges: string[] = []): WorldGraph {
  return {
    nodes: nodes.map((name) => ({
      id: name.toLowerCase(),
      name,
      types: ['core.note'],
    })),
    edges: edges.map((e) => {
      const [left, target] = e.split('>');
      const [source, descriptor] = left.split('-');
      return { source, target, descriptor: descriptor ?? null };
    }),
  };
}

describe('graphPayload', () => {
  it('addresses nodes by index, and links by pairs of those indices', () => {
    const payload = graphPayload(world(['Ealdred', 'Mira'], ['ealdred-spouse>mira']));

    const at = (name: string) => payload.nodes.findIndex((n) => n.name === name);
    expect(payload.links).toEqual(new Float32Array([at('Ealdred'), at('Mira')]));
    expect(payload.descriptors).toEqual(['spouse']);
  });

  /**
   * Hub bias, and the reason point order is ours to choose. cosmos.gl's label sampling is a GPU
   * pass with no blending, drawn in point-index order — so within a sampling cell the **highest
   * index wins**. There is no API for it; ordering by ascending degree is how a hub out-labels the
   * orphans drifting around it. Get this backwards and the busiest Entity is the one never named.
   */
  it('orders points by ascending degree, so the highest index in a cell is the hub', () => {
    const payload = graphPayload(
      world(
        ['Mira', 'Aldermoor', 'Unvisited Isle', 'Ealdred'],
        ['ealdred>aldermoor', 'mira>aldermoor', 'aldermoor>ealdred'],
      ),
    );

    expect(payload.nodes.map((n) => n.name)).toEqual([
      'Unvisited Isle', // degree 0
      'Mira', // degree 1
      'Ealdred', // degree 2
      'Aldermoor', // degree 3 — the hub, at the highest index
    ]);
    expect([...payload.degrees]).toEqual([0, 1, 2, 3]);
  });

  /**
   * The server guarantees `edges ⊆ nodes × nodes`, so this is belt-and-braces — but a link naming
   * a point that isn't there would index off the end of the position array, and cosmos.gl would
   * draw a line to the origin rather than fail. Dropping it must not shift `descriptors`, which is
   * keyed by *link* index and is the only way back from a sampled link to its Link Descriptor.
   */
  it('drops a link to an absent node without misaligning the descriptors', () => {
    const payload = graphPayload(world(['Mira'], ['mira-haunts>the-drowned-keep', 'mira-loves>mira']));

    expect(payload.links).toEqual(new Float32Array([0, 0]));
    expect(payload.descriptors).toEqual(['loves']);
  });

  /**
   * The degree that *ordered* a node and the degree that *sizes* it are one number, so an edge the
   * payload drops may inflate neither. Count Mira's two links into the void and she sorts above the
   * Entities that actually link — handing the top index, and with it the hub's label priority, to
   * the one node drawn with no lines at all.
   */
  it('counts only the links it draws, so a dropped one never inflates a degree', () => {
    const payload = graphPayload(
      world(
        ['Mira', 'Ealdred', 'Aldermoor'],
        ['mira-haunts>the-drowned-keep', 'mira-haunts>the-sunken-hall', 'ealdred-spouse>aldermoor'],
      ),
    );

    expect(payload.nodes.map((n) => n.name)).toEqual(['Mira', 'Ealdred', 'Aldermoor']);
    expect([...payload.degrees]).toEqual([0, 1, 1]);
  });
});
