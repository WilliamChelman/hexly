import { LinkedEntity, WorldGraph } from '@hexly/domain';

/**
 * The {@link WorldGraph} as cosmos.gl wants it: flat, index-addressed arrays. The renderer
 * addresses every point and link by its position in these arrays and hands those indices back on
 * click, hover and label sampling, so this is also the only way back from an index to the Entity
 * it draws — hence `nodes`, re-ordered and authoritative.
 */
export interface GraphPayload {
  /** The nodes in point-index order — **not** the server's order. */
  readonly nodes: readonly LinkedEntity[];
  /** Each node's link count, by point index. */
  readonly degrees: Uint32Array;
  /** Link index pairs, two entries per link, into {@link nodes}. */
  readonly links: Float32Array;
  /** One per link, aligned to link index; `''` where the link carries no Link Descriptor. */
  readonly descriptors: readonly string[];
}

/**
 * Build the index-addressed arrays for one World Graph.
 *
 * Points come out ordered by **ascending degree**, which buys hub-biased labels.
 * `getSampledPointPositionsMap` is a GPU pass: points rasterise into a grid-sized framebuffer with
 * `depthCompare: 'always'` and no blending, in point-index order, so within a sampling cell the
 * highest index wins. There is no API for choosing the winner — ordering is the API.
 */
export function graphPayload(graph: WorldGraph): GraphPayload {
  // Degree by id, before any index exists — the ordering below is what mints the indices. Only the
  // edges this payload will actually carry may count: an edge naming an absent node is dropped
  // below, and a degree that counted it would size and order its endpoint as a hub it is not.
  const degreeOf = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (const edge of graph.edges) {
    if (!degreeOf.has(edge.source) || !degreeOf.has(edge.target)) continue;
    // Re-read between the two writes, so a self-link counts once at each of its own ends.
    degreeOf.set(edge.source, (degreeOf.get(edge.source) ?? 0) + 1);
    degreeOf.set(edge.target, (degreeOf.get(edge.target) ?? 0) + 1);
  }
  // A stable sort, so nodes of equal degree keep the server's name order.
  const nodes = [...graph.nodes].sort((a, b) => (degreeOf.get(a.id) ?? 0) - (degreeOf.get(b.id) ?? 0));
  const indexOf = new Map(nodes.map((n, i) => [n.id, i]));
  // Read off the map the order itself came from, so what sizes a node and what ordered it are the
  // same number by construction — they cannot drift into disagreeing about one dropped edge.
  const degrees = Uint32Array.from(nodes, (n) => degreeOf.get(n.id) ?? 0);

  const links: number[] = [];
  const descriptors: string[] = [];
  for (const edge of graph.edges) {
    const source = indexOf.get(edge.source);
    const target = indexOf.get(edge.target);
    if (source === undefined || target === undefined) continue;
    links.push(source, target);
    descriptors.push(edge.descriptor ?? '');
  }

  return { nodes, degrees, links: new Float32Array(links), descriptors };
}
