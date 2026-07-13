import { Observable, Subject, finalize, merge, share, tap } from 'rxjs';
import { FollowSignal, InterestRef } from '@hexly/domain';
import { NudgeBusClient } from './nudge-bus.client';
import { Watched, watchResource } from './live-follow';

/** How a {@link FollowStore} follows one kind of resource. */
export interface FollowStoreConfig {
  /** The interest ref kind (`entity` | `world`) this store follows. */
  kind: InterestRef['kind'];
  /** Trailing-debounce window before a nudge triggers a refetch. */
  debounceMs: number;
  /** Log a swallowed transient refetch failure (5xx / network blip) — omit to stay silent. */
  onRefetchError?: (err: unknown) => void;
}

/** Anything carrying the freshness key: a loaded detail, or an incoming nudge. */
interface Sequenced {
  id: string;
  seq: number;
}

/**
 * The write-through live-follow store for one resource kind (ADR-0044) — **library-internal**,
 * reached only through its client ({@link EntitiesClient}, {@link WorldsClient}), never a consumer.
 * It holds the freshest version of resource X anyone here has seen, fed from *both* directions:
 *
 * - the **network**: a server nudge newer than the held version drives one debounced refetch, shared
 *   by every watcher (N followers → one `GET`), and the result advances the held version.
 * - **local writes**: {@link merge} publishes a detail the client just saved/patched/loaded, so it
 *   fans out to every other watcher with *no roundtrip*, and — because the held version advances —
 *   the server's own echo nudge for that write dedups to nothing (no self-refetch).
 *
 * The store decides *when to fetch*; a consumer that shouldn't *apply* a given emission (an editor
 * mid-edit, a stale in-flight read) filters it at subscribe time.
 */
export class FollowStore<T extends Sequenced> {
  /**
   * Held freshness per id — persistent, so it outlives a watch and a reopened follow still dedups a
   * self-echo. Seeded monotonically by every read/write/refetch. Unbounded: one detail per resource
   * ever touched.
   */
  private readonly held = new Map<string, T>();
  /** The refcounted fanout stream per id (shared across concurrent watchers). */
  private readonly streams = new Map<string, Observable<Watched<T>>>();
  /** The local-write publish channel per id, feeding the fanout — present only while watched. */
  private readonly pushes = new Map<string, Subject<T>>();

  constructor(
    private readonly bus: NudgeBusClient,
    private readonly cfg: FollowStoreConfig,
  ) {}

  /**
   * Live-follow one resource, shared across all concurrent callers of the same id. Emits a fresh
   * detail (network refetch on a nudge newer than held, or a local write's fanout) or
   * {@link Watched}'s `EVICTED`. `fetch` is how to reload it.
   */
  watch(id: string, fetch: () => Observable<T>): Observable<Watched<T>> {
    let stream = this.streams.get(id);
    if (!stream) {
      const pushes = new Subject<T>();
      this.pushes.set(id, pushes);
      stream = merge(
        // Local writes fanned out to every watcher — no roundtrip.
        pushes,
        // Network: refetch on a nudge newer than held, and advance held from the result.
        watchResource({
          follow: this.bus.follow({ kind: this.cfg.kind, id }),
          fetch: () => fetch().pipe(tap((d) => this.seen(d))),
          debounceMs: this.cfg.debounceMs,
          shouldRefetch: (n) => this.isNewer(id, n),
          onTransientError: this.cfg.onRefetchError,
        }),
      ).pipe(
        finalize(() => {
          this.streams.delete(id);
          this.pushes.delete(id);
        }),
        share(),
      );
      this.streams.set(id, stream);
    }
    return stream;
  }

  /**
   * Write-through: publish a detail the client obtained directly (a save/patch/load response).
   * Advances the held version *synchronously* so the server's echo nudge dedups, and fans it out to
   * watchers on a microtask — deferred so a caller that both writes and watches (an editor) has
   * finished handling its own write before its watch sees the echo, else it would re-seed its save.
   */
  merge(detail: T): void {
    this.seen(detail);
    const pushes = this.pushes.get(detail.id);
    if (pushes) Promise.resolve().then(() => pushes.next(detail));
  }

  /** Monotonic: advance held only to a strictly newer detail, so a late/stale read can't regress it. */
  private seen(d: T): void {
    const held = this.held.get(d.id);
    if (!held || d.seq > held.seq) this.held.set(d.id, d);
  }

  /** The freshness gate: one `seq` on every resource kind, bumped by every committed change (ADR-0045). */
  private isNewer(id: string, n: FollowSignal): boolean {
    // A signal carrying no `seq` makes no freshness claim, so it is never gated: a `stale`
    // reconnect pulse must refetch unconditionally to reconcile the gap. (An `unavailable`
    // eviction also has no `seq`, but never reaches here — `watchResource` splits it off to
    // EVICTED upstream of this gate.)
    if (!('seq' in n)) return true;
    const held = this.held.get(id);
    return !held || n.seq > held.seq;
  }
}
