import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { EMPTY, catchError, distinctUntilChanged, map, switchMap } from 'rxjs';
import { LOCAL_GRAPH_DEFAULT_DEPTH, LOCAL_GRAPH_MAX_DEPTH, LocalGraph } from '@hexly/domain';
import { AuthScopedStorage, EntitiesClient } from '@hexly/web-core';
import { ENTITY_SESSION } from '../models/entity-session';
import { withoutDecorEdges } from '../graph/orphans';

/** A fetched neighbourhood, tagged with the Entity and depth it was fetched for. */
interface Loaded {
  readonly id: string;
  readonly depth: number;
  readonly value: LocalGraph;
}

/** The depths a reader may choose — every hop the read allows, 1…{@link LOCAL_GRAPH_MAX_DEPTH}. */
export const LOCAL_GRAPH_DEPTHS: readonly number[] = Array.from({ length: LOCAL_GRAPH_MAX_DEPTH }, (_, i) => i + 1);

/**
 * UI state for the **Local Graph Panel** (ADR-0072) — the open Entity's neighbourhood, `depth` hops out,
 * off the same derived edge index the World Graph draws (ADR-0046).
 *
 * Panel-scoped like {@link ReferencesStore}: it lives only while the Panel is open, so "nothing fetched
 * while closed" and "opening always fetches" fall out of the lifecycle. The fetch is keyed on the open
 * Entity's `(id, seq)` (ADR-0045) *and* the chosen depth — the depth is a server bound, so changing it is
 * a refetch, not a filter. Its freshness ceiling is the References panel's: `seq` tracks this Entity
 * alone, so a neighbour's rename or a link added from the other end lands on reopen or renavigation.
 *
 * The Panel stays open across `:id` changes (it is page chrome), so a held graph is tagged with the
 * Entity it was fetched for and drawn only for that Entity: swapping Entities blanks the drawing rather
 * than briefly attributing one Entity's neighbourhood to another.
 */
@Injectable()
export class LocalGraphStore {
  private readonly session = inject(ENTITY_SESSION);
  private readonly entities = inject(EntitiesClient);

  private readonly _loaded = signal<Loaded | null>(null);

  /**
   * How many hops out the drawing reaches. **Persisted per user** (a roaming-free device preference, as
   * the nav rail's pin is): a reader who works two hops out means it for every Entity they open, unlike
   * the ephemeral decor peek below. Defaults to one hop.
   */
  private readonly depthPref = inject(AuthScopedStorage).preference<string>({
    storageKey: 'local-graph-depth',
    values: LOCAL_GRAPH_DEPTHS.map(String),
    detect: () => `${LOCAL_GRAPH_DEFAULT_DEPTH}`,
    apply: () => {
      /* nothing to apply outside this store — the fetch keys on it */
    },
  });

  /** The chosen depth, as the control and the fetch read it. */
  readonly depth = computed(() => Number(this.depthPref.value()));
  /** The hops the control offers. */
  readonly depths = LOCAL_GRAPH_DEPTHS;

  /**
   * Whether the drawing reveals its Decor Links (ADR-0069) — ephemeral and default-hidden, exactly as on
   * the World Graph page. Decor never *widens* the neighbourhood (the server walks semantic edges only),
   * so revealing it can only annotate the picture already drawn.
   */
  private readonly _revealDecor = signal(false);
  readonly revealDecor = this._revealDecor.asReadonly();

  /** The held graph, but only while it still describes the open Entity at the chosen depth. */
  private readonly current = computed(() => {
    const held = this._loaded();
    if (held?.id !== this.session.current()?.id) return undefined;
    // A depth change refetches; until it lands, the graph held at the old depth would misreport the
    // control's reading, so it is withheld rather than redrawn.
    return held?.depth === this.depth() ? held.value : undefined;
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
    return this._revealDecor() ? graph : withoutDecorEdges(graph);
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

  /** Set how many hops out to draw; out-of-range values are ignored (the control offers {@link depths}). */
  setDepth(depth: number): void {
    if (LOCAL_GRAPH_DEPTHS.includes(depth)) this.depthPref.set(`${depth}`);
  }

  /** Flip the ephemeral decor reveal. */
  toggleRevealDecor(): void {
    this._revealDecor.update((revealed) => !revealed);
  }

  constructor() {
    /** What the panel wants loaded — the open Entity's `(id, seq)` and the chosen depth. */
    const target = computed(() => {
      const entity = this.session.current();
      return entity ? { id: entity.id, seq: entity.seq, depth: this.depth() } : null;
    });

    toObservable(target)
      .pipe(
        distinctUntilChanged((a, b) => a?.id === b?.id && a?.seq === b?.seq && a?.depth === b?.depth),
        // Cancels an outrun fetch, so a fast depth flip can never land out of order.
        switchMap((t) =>
          t
            ? this.entities.localGraph(t.id, t.depth).pipe(
                map((value): Loaded => ({ id: t.id, depth: t.depth, value })),
                // A failed fetch leaves the last-known graph rather than blanking the panel.
                catchError(() => EMPTY),
              )
            : EMPTY,
        ),
        takeUntilDestroyed(),
      )
      .subscribe((loaded) => {
        // The peek never survives past the graph it was opened against.
        this._revealDecor.set(false);
        this._loaded.set(loaded);
      });
  }

  /** Seed the panel directly, bypassing the fetch — the test seam, mirroring {@link ReferencesStore.adopt}. */
  adopt(id: string, value: LocalGraph): void {
    this._loaded.set({ id, depth: value.depth, value });
  }
}
