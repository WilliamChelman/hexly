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

/**
 * The graph with its **Decor Link** edges dropped — what the show-decor toggle draws when off (the
 * default, ADR-0069). Nodes are untouched here; orphan computation runs on the result, so an Asset
 * whose only edges were decor becomes an ordinary orphan and falls out under the show-orphans toggle,
 * with no asset-specific rule. An Asset deliberately Embedded on a Board keeps its semantic edge and
 * stays. Applied *after* the server's access filter — hiding decor never widens what a Viewer sees.
 */
export function withoutDecorEdges(graph: WorldGraph): WorldGraph {
  if (!graph.edges.some((e) => e.decor)) return graph;
  return { nodes: graph.nodes, edges: graph.edges.filter((e) => !e.decor) };
}

/** How many edges are Decor Links — drives the show-decor toggle's visibility and count. */
export function decorEdgeCount(graph: WorldGraph): number {
  return graph.edges.filter((e) => e.decor).length;
}
