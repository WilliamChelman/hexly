import { Inject, Injectable } from '@nestjs/common';
import { LocalGraph, WorldGraphEdge } from '@hexly/domain';
import { entityAccess } from '../acl/entity-access';
import { DB, Db } from '../db/db';
import { foreignNodeIds, worldGraphRead } from './utils/graph-reads';

/**
 * The Local Graph read (ADR-0072): the World Graph narrowed to one Entity's neighbourhood, `depth`
 * hops out. Same projection of the derived edge index (ADR-0046), same both-endpoints access filter —
 * the neighbourhood is walked over the graph the *viewer* can see, so a private Entity is not a bridge
 * to anything, it simply is not there.
 *
 * The World-wide reads run first and the walk narrows them in memory: at this scale (one embedded
 * SQLite World) a recursive-CTE walk would buy nothing but a second definition of what an edge is.
 */
@Injectable()
export class LocalGraphService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * One Entity's neighbourhood. `null` when the Entity is unreachable — the same existence-preserving
   * 404 gate as `EntitiesService.load`, so an Entity someone else owns stays indistinguishable from one
   * that does not exist. It is the World gate too: reading an Entity takes a grant on it or membership
   * of its World, and either makes that World reachable (ADR-0024/0037), so `WorldGraphService`'s
   * explicit check would refuse nothing here.
   */
  localGraph(userId: string, id: string, depth: number): LocalGraph | null {
    const access = entityAccess(this.db, userId);
    const center = access.decide(id);
    if (!center?.canRead) return null;

    const graph = worldGraphRead(this.db, access, center.row.containerId);
    const { nodes, edges } = graph;
    const kept = neighbourhood(id, edges, depth, foreignNodeIds(graph));

    return {
      center: id,
      depth,
      nodes: nodes.filter((n) => kept.has(n.id)),
      // Every kept node is reachable over semantic edges, so an edge with both ends kept is drawn —
      // decor included, flag intact, for the client's reveal.
      edges: edges.filter((e) => kept.has(e.source) && kept.has(e.target)),
    };
  }
}

/**
 * The ids within `depth` hops of `center`, walking edges as **undirected** — "what is this Entity's
 * neighbourhood" is not a question about which end authored the link.
 *
 * **Semantic edges only** (ADR-0069): a Decor Link is presentation, so it never widens the
 * neighbourhood. That is also what makes the result connected by construction — every returned node
 * has a semantic path to the centre — so the drawn graph has no orphans and needs no orphans filter.
 *
 * A **Foreign node** is reached and never left (ADR-0080): it joins the neighbourhood at the hop that
 * found it and is not walked on from. Terminal by rule, not by accident — the far side of the boundary
 * is another campaign's shape, and no depth is allowed to trace it into this one's Panel. It bounds
 * this side too: two Entities sharing one shelf image are not thereby two hops apart.
 */
function neighbourhood(
  center: string,
  edges: readonly WorldGraphEdge[],
  depth: number,
  foreign: ReadonlySet<string>,
): ReadonlySet<string> {
  const adjacency = new Map<string, string[]>();
  const link = (from: string, to: string) => {
    const known = adjacency.get(from);
    if (known) known.push(to);
    else adjacency.set(from, [to]);
  };
  for (const edge of edges) {
    if (edge.decor) continue;
    link(edge.source, edge.target);
    link(edge.target, edge.source);
  }

  const seen = new Set([center]);
  let frontier = [center];
  for (let hop = 0; hop < depth && frontier.length; hop++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const neighbour of adjacency.get(id) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        if (!foreign.has(neighbour)) next.push(neighbour);
      }
    }
    frontier = next;
  }
  return seen;
}
