import { WorldGraph } from '@hexly/domain';
import { decorEdgeCount, orphanIds, withoutDecorEdges, withoutOrphans } from './orphans';

/**
 * A World of `nodes`, linked by `edges` given as `'source>target'`. A trailing `!` marks a Decor Link
 * (`'ealdred>portrait!'`), so a spec can express decor-vs-semantic edges tersely.
 */
function world(nodes: string[], edges: string[] = []): WorldGraph {
  return {
    nodes: nodes.map((name) => ({ id: name.toLowerCase(), name, types: ['core.type.note'] })),
    edges: edges.map((e) => {
      const decor = e.endsWith('!');
      const [source, target] = (decor ? e.slice(0, -1) : e).split('>');
      return { source, target, descriptor: null, decor };
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

describe('withoutDecorEdges (ADR-0069)', () => {
  it('drops decor edges and keeps semantic ones', () => {
    const graph = world(['Ealdred', 'Mira', 'Portrait'], ['ealdred>mira', 'ealdred>portrait!']);
    const shown = withoutDecorEdges(graph);
    expect(shown.edges).toEqual([{ source: 'ealdred', target: 'mira', descriptor: null, decor: false }]);
    // Nodes are untouched — orphan computation is what drops the now-unlinked Portrait.
    expect(shown.nodes).toBe(graph.nodes);
  });

  /** No decor, no copy: the same object flows through so the canvas need not remount. */
  it('returns the graph unchanged when there are no decor edges', () => {
    const graph = world(['A', 'B'], ['a>b']);
    expect(withoutDecorEdges(graph)).toBe(graph);
  });

  /**
   * The decision that makes assets fall out with no asset-specific code (ADR-0069): a node whose only
   * edge is decor is *not* an orphan on the full graph, but *becomes* one once decor is filtered — so the
   * decor filter must run before orphan computation.
   */
  it('turns a decor-only node into an orphan once decor is filtered', () => {
    const graph = world(['Ealdred', 'Portrait'], ['ealdred>portrait!']);
    expect(orphanIds(graph)).toEqual(new Set()); // inbound decor edge → not an orphan on the raw graph
    expect(orphanIds(withoutDecorEdges(graph))).toEqual(new Set(['ealdred', 'portrait']));
  });

  /** An Asset deliberately Embedded (semantic) keeps its edge, so it survives the decor filter. */
  it('keeps a node reached by a semantic edge even when it also has decor edges', () => {
    const graph = world(['Board', 'Asset'], ['board>asset', 'board>asset!']);
    expect(orphanIds(withoutDecorEdges(graph))).toEqual(new Set());
  });

  /**
   * A **Foreign node** is subject to the reveal like any other (ADR-0080): a shelf image is reached by a
   * decor edge, so it stays behind the reveal, and a mood board's fifty borrowed pictures stay quiet.
   * Being foreign is a mark on the node, never an exemption from a filter.
   */
  it('holds a Foreign node behind the decor reveal when the edge that reached it is decor', () => {
    const graph = world(['Mood Board', 'Shelf Portrait'], ['mood board>shelf portrait!']);
    const foreign = {
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === 'shelf portrait' ? { ...n, foreignContainerId: 'w-shelf' } : n)),
    };

    expect(orphanIds(withoutDecorEdges(foreign))).toEqual(new Set(['mood board', 'shelf portrait']));
    // With decor revealed it is drawn, marked, exactly as the World Graph read sent it.
    expect(withoutOrphans(foreign).nodes.map((n) => n.foreignContainerId)).toEqual([undefined, 'w-shelf']);
  });

  it('counts decor edges', () => {
    expect(decorEdgeCount(world(['A', 'B', 'C'], ['a>b', 'a>c!']))).toBe(1);
    expect(decorEdgeCount(world(['A', 'B'], ['a>b']))).toBe(0);
  });
});
