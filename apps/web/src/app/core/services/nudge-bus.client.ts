import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { EMPTY, Observable, Subject, catchError, filter } from 'rxjs';
import {
  ConnectionReady,
  EntityNudge,
  InterestRef,
  NudgeDelta,
} from '@hexly/domain';

/**
 * The client half of the live-follow nudge bus (ADR-0044, #173). Opens one multiplexed SSE
 * stream (`GET /api/events`) for the whole tab, captures the `connectionId` its first frame
 * mints, and declares the *whole* interest set via `PUT /api/events/:connectionId/interest`.
 *
 * Interest is subscription-scoped: {@link follow} returns the nudge stream for one ref, and
 * *subscribing* is what declares interest — unsubscribing withdraws it. A ref is reference-counted,
 * so N followers of the same resource share one server-side subscription and only the last to
 * leave withdraws it; a caller never manages unfollow by hand (its teardown does).
 *
 * The stream opens lazily on the first follower — a tab watching nothing holds no connection.
 *
 * Spine slice: entity refs, `{ id, version }` only. Reconnect re-sync, heartbeat, the
 * `unavailable` eviction entry, and World refs are additive later slices (#171).
 */
@Injectable({ providedIn: 'root' })
export class NudgeBusClient {
  private readonly http = inject(HttpClient);

  private source: EventSource | null = null;
  private connectionId: string | null = null;
  /** Live interest, reference-counted per ref key, so shared follows don't clobber each other. */
  private readonly interest = new Map<string, { ref: InterestRef; count: number }>();
  /** Coalesce flag: many acquire/release calls in one turn collapse to a single interest flush. */
  private declareScheduled = false;

  private readonly nudges = new Subject<EntityNudge>();

  /**
   * The stream of nudges for one resource. Subscribing declares interest in it (and opens the
   * connection if this is the first follower); unsubscribing withdraws it once the last follower
   * leaves. So a follower is `bus.follow(ref).pipe(...)` under a `switchMap`/`takeUntilDestroyed`
   * — teardown handles withdrawal.
   */
  follow(ref: InterestRef): Observable<EntityNudge> {
    return new Observable<EntityNudge>((subscriber) => {
      this.acquire(ref);
      const inner = this.nudges
        .pipe(filter((n) => n.id === ref.id))
        .subscribe(subscriber);
      return () => {
        inner.unsubscribe();
        this.release(ref);
      };
    });
  }

  private acquire(ref: InterestRef): void {
    const key = keyOf(ref);
    const entry = this.interest.get(key);
    if (entry) {
      entry.count++;
      return; // already declared — nothing changes on the wire
    }
    this.interest.set(key, { ref, count: 1 });
    this.ensureOpen();
    this.scheduleDeclare();
  }

  private release(ref: InterestRef): void {
    const key = keyOf(ref);
    const entry = this.interest.get(key);
    if (!entry) return;
    if (--entry.count > 0) return; // other followers still watching
    this.interest.delete(key);
    this.scheduleDeclare();
  }

  private ensureOpen(): void {
    if (this.source) return;
    // jsdom (unit tests) has no EventSource — stay inert rather than throw. The mock stands in
    // for the connection there; this guard keeps the real client harmless when injected.
    if (typeof EventSource === 'undefined') return;
    // Relative URL → same origin, so the session cookie rides automatically (ADR-0008).
    this.source = new EventSource('/api/events');
    this.source.addEventListener('ready', (e) => {
      this.connectionId = (JSON.parse((e as MessageEvent).data) as ConnectionReady).connectionId;
      this.scheduleDeclare(); // flush interest gathered before the id arrived
    });
    this.source.addEventListener('nudge', (e) => {
      const delta = JSON.parse((e as MessageEvent).data) as NudgeDelta;
      for (const entry of delta) this.nudges.next(entry);
    });
  }

  /**
   * Coalesce interest changes onto one microtask flush. An Entity swap drives a synchronous
   * release(old)+acquire(new) pair; without coalescing that fires two racing PUTs (an empty set
   * and the new set) whose order isn't guaranteed — the empty one landing last would silently
   * stop nudges. One flush per turn sends only the final set.
   */
  private scheduleDeclare(): void {
    if (this.declareScheduled) return;
    this.declareScheduled = true;
    queueMicrotask(() => {
      this.declareScheduled = false;
      this.flushInterest();
    });
  }

  private flushInterest(): void {
    if (this.interest.size === 0) {
      // Nothing watched: drop the connection so an idle tab holds none (the server reaps it on
      // close). A later follow reopens it via ensureOpen.
      this.source?.close();
      this.source = null;
      this.connectionId = null;
      return;
    }
    // Can't address the PUT until the handshake names the connection; the `ready` handler
    // re-flushes once it lands, so nothing is lost.
    if (!this.connectionId) return;
    this.http
      .put<void>(`/api/events/${this.connectionId}/interest`, {
        refs: [...this.interest.values()].map((e) => e.ref),
      })
      // A stale-connection 4xx (the server reaped it while EventSource silently reconnected) or a
      // transient 5xx is swallowed: the next `ready` re-declares against the fresh connectionId.
      .pipe(catchError(() => EMPTY))
      .subscribe();
  }
}

/** A stable key for a ref so the interest set is a proper set (kind+id). */
function keyOf(ref: InterestRef): string {
  return `${ref.kind}:${ref.id}`;
}
