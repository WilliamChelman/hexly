import { WorldGraph } from '@hexly/domain';
import { orphanIds, withoutOrphans } from './orphans';

/** A World of `nodes`, linked by `edges` given as `'source>target'`. */
function world(nodes: string[], edges: string[] = []): WorldGraph {
  return {
    nodes: nodes.map((name) => ({ id: name.toLowerCase(), name, types: ['core.type.note'] })),
    edges: edges.map((e) => {
      const [source, target] = e.split('>');
      return { source, target, descriptor: null };
    }),
  };
}

describe('orphanIds', () => {
  it('flags a node in no edge, either direction', () => {
    const graph = world(['Ealdred', 'Mira', 'Unvisited Isle'], ['ealdred>mira']);
    expect(orphanIds(graph)).toEqual(new Set(['unvisited isle']));
  });

  /** Inbound alone is usage: an Asset only ever *linked to* is not an orphan (ADR-0065). */
  it('does not flag a node reached only by an inbound edge', () => {
    const graph = world(['Ealdred', 'Portrait'], ['ealdred>portrait']);
    expect(orphanIds(graph)).toEqual(new Set());
  });

  it('is empty when every node is linked', () => {
    expect(orphanIds(world(['A', 'B'], ['a>b']))).toEqual(new Set());
  });
});

describe('withoutOrphans', () => {
  it('drops orphan nodes and keeps every edge', () => {
    const graph = world(['Ealdred', 'Mira', 'Unvisited Isle'], ['ealdred>mira']);
    const shown = withoutOrphans(graph);
    expect(shown.nodes.map((n) => n.name)).toEqual(['Ealdred', 'Mira']);
    expect(shown.edges).toBe(graph.edges);
  });

  /** No orphans, no copy: the same object flows through so the canvas need not remount. */
  it('returns the graph unchanged when there are no orphans', () => {
    const graph = world(['A', 'B'], ['a>b']);
    expect(withoutOrphans(graph)).toBe(graph);
  });
});
