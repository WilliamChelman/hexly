import { Injectable, computed, inject } from '@angular/core';
import { LOCAL_GRAPH_DEFAULT_DEPTH, LOCAL_GRAPH_MAX_DEPTH, LocalGraph } from '@hexly/domain';
import { AuthScopedStorage, EntitiesClient } from '@hexly/web-core';
import { withoutDecorEdges } from '../graph/orphans';
import { EntityPanelStore } from './entity-panel-store';

/** The depths a reader may choose — every hop the read allows, 1…{@link LOCAL_GRAPH_MAX_DEPTH}. */
export const LOCAL_GRAPH_DEPTHS: readonly number[] = Array.from({ length: LOCAL_GRAPH_MAX_DEPTH }, (_, i) => i + 1);

/** Clamped, never refused — the same contract `localGraphQuerySchema` applies server-side (ADR-0072). */
function clampDepth(depth: number): number {
  return Math.min(Math.max(Math.round(depth) || LOCAL_GRAPH_DEFAULT_DEPTH, 1), LOCAL_GRAPH_MAX_DEPTH);
}

/**
 * UI state for the **Local Graph Panel** (ADR-0072) — the open Entity's neighbourhood, `depth` hops out,
 * off the same derived edge index the World Graph draws (ADR-0046).
 *
 * The fetch is keyed on the open Entity's `(id, seq)` (ADR-0045) *and* the chosen depth — the depth is a
 * server bound, so changing it is a refetch, not a filter. Its freshness ceiling is the References
 * panel's: `seq` tracks this Entity alone, so a neighbour's rename or a link added from the other end
 * lands on reopen or renavigation.
 */
@Injectable()
export class LocalGraphStore extends EntityPanelStore<LocalGraph> {
  private readonly entities = inject(EntitiesClient);

  /**
   * How many hops out the drawing reaches. **Persisted per user** (a roaming-free device preference, as
   * the nav rail's pin is): a reader who works two hops out means it for every Entity they open, unlike
   * the ephemeral decor peek. Defaults to one hop.
   *
   * `AuthPreference` is a localStorage gateway and so string-shaped; {@link depth} and {@link setDepth}
   * are the only crossing, so the number never leaks out as text.
   */
  private readonly depthPref = inject(AuthScopedStorage).preference<string>({
    storageKey: 'local-graph-depth',
    values: LOCAL_GRAPH_DEPTHS.map(String),
    detect: () => `${LOCAL_GRAPH_DEFAULT_DEPTH}`,
    apply: () => undefined, // Nothing outside this store reacts to it — the fetch keys on the signal.
  });

  /** The chosen depth, as the control and the fetch read it. */
  readonly depth = computed(() => clampDepth(Number(this.depthPref.value())));
  /** The hops the control offers. */
  readonly depths = LOCAL_GRAPH_DEPTHS;

  /**
   * A read is in flight for something the drawing does not show yet — a first open, or a depth other than
   * the one the held graph was walked at. The held graph is *kept* across that refetch: unmounting the
   * canvas would make the next mount rebuild cosmos.gl's WebGL context and recompile its shaders on the
   * main thread (the warm pool holds one graph, and it is already spent), so the panel marks the drawing
   * stale instead of tearing it down — and stands its counts down, since those are the precise claim a
   * graph held at the old depth would misreport.
   */
  readonly loading = computed(() => {
    if (!this.session.current()) return false;
    const graph = this.current();
    // `LocalGraph.depth` is the depth the server actually walked, so this reads the drawing itself
    // rather than a second copy of the request.
    return graph === undefined || graph.depth !== this.depth();
  });

  /** The Entity the drawing is centred on, or `null` before the first graph lands. */
  readonly center = computed(() => this.current()?.center ?? null);

  /**
   * The graph as drawn: Decor Links dropped unless the reveal is on (ADR-0069). No orphans filter —
   * every node the read returns has a semantic path to the centre, so there are none to hide.
   */
  readonly graph = computed(() => {
    const graph = this.current();
    if (!graph) return null;
    return this.revealDecor() ? graph : withoutDecorEdges(graph);
  });

  /** There is decor to reveal — the reveal control renders only then, never as dead chrome. */
  readonly hasDecor = computed(() => (this.current()?.edges ?? []).some((edge) => edge.decor));
  /**
   * The centre stands alone: the read came back with nothing but itself. Read off {@link graph}, so it is
   * `false` until the read lands — the panel claims "links to nothing" only once it knows. Every other node
   * has a semantic path to the centre, so an edge-less graph is always a graph of one; hiding decor cannot
   * produce this state, only a genuinely unlinked Entity can.
   */
  readonly isolated = computed(() => this.graph()?.edges.length === 0);

  /** Set how many hops out to draw. Clamped, not refused — the read answers the same way (ADR-0072). */
  setDepth(depth: number): void {
    this.depthPref.set(`${clampDepth(depth)}`);
  }

  constructor() {
    super();
    const target = computed(() => {
      const entity = this.session.current();
      return entity ? { id: entity.id, seq: entity.seq, depth: this.depth() } : null;
    });

    this.fetchOn(target, (t) => this.entities.localGraph(t.id, t.depth));
  }
}
