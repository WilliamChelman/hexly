import { WorldGraph } from '@hexly/domain';

/**
 * An **orphan** is a node in no edge — no inbound link, no outbound one — whatever its type
 * (ADR-0065). The rule is generic on purpose: bulk-minted Assets are the flood it holds back, but
 * it never special-cases a type, so an unlinked Note hides on the same footing.
 *
 * The endpoints named by {@link WorldGraph.edges} are exactly the non-orphans, since an edge the
 * viewer cannot fully see is already dropped server-side.
 */
export function orphanIds(graph: WorldGraph): ReadonlySet<string> {
  const linked = new Set<string>();
  for (const edge of graph.edges) {
    linked.add(edge.source);
    linked.add(edge.target);
  }
  return new Set(graph.nodes.filter((n) => !linked.has(n.id)).map((n) => n.id));
}

/**
 * The graph with its orphan nodes dropped — what the show-orphans toggle draws when off (the
 * default). Edges are untouched: an edge references only non-orphans by definition, so nothing
 * dangles.
 */
export function withoutOrphans(graph: WorldGraph): WorldGraph {
  const orphans = orphanIds(graph);
  if (orphans.size === 0) return graph;
  return { nodes: graph.nodes.filter((n) => !orphans.has(n.id)), edges: graph.edges };
}
