import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { EMPTY, Observable, Subject, catchError, filter } from 'rxjs';
import { ConnectionReady, FollowSignal, InterestRef, NudgeDelta } from '@hexly/domain';

import { safeJsonParse } from '../utils/safe';

/**
 * The client half of the live-follow nudge bus. Opens one multiplexed SSE stream
 * (`GET /api/events`) for the whole tab, captures the `connectionId` its first frame
 * mints, and declares the *whole* interest set via `PUT /api/events/:connectionId/interest`.
 *
 * Interest is subscription-scoped: *subscribing* to {@link follow} declares interest,
 * unsubscribing withdraws it. A ref is reference-counted, so N followers share one server-side
 * subscription and only the last to leave withdraws it. The stream opens lazily on the first
 * follower — a tab watching nothing holds no connection. An entry is either a `{ id, version }`
 * delta or an opaque `{ id, unavailable }` eviction; the bus relays both.
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

  /** Server nudges plus the client's own `stale` reconnect pulses (#177) — the follow stream. */
  private readonly nudges = new Subject<FollowSignal>();

  /**
   * The stream of nudges for one resource. Subscribing declares interest (opening the connection
   * if this is the first follower); unsubscribing withdraws it once the last follower leaves.
   */
  follow(ref: InterestRef): Observable<FollowSignal> {
    return new Observable<FollowSignal>((subscriber) => {
      this.acquire(ref);
      const inner = this.nudges.pipe(filter((n) => n.id === ref.id)).subscribe(subscriber);
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
    // Relative URL → same origin, so the session cookie rides automatically. Every principal is the
    // cookie now: the anonymous token path retired with the Public Link (ADR-0084).
    this.source = new EventSource('/api/events');
    this.source.addEventListener('ready', (e) => {
      // A `ready` while we already hold a connectionId is a *gap reconnect* on the same
      // EventSource (native auto-reconnect), not the first handshake — the mint differs each open.
      const reconnected = this.connectionId !== null;
      const ready = safeJsonParse<ConnectionReady>((e as MessageEvent).data);
      if (ready.isErr()) return; // malformed handshake: ignore rather than throw in the listener
      this.connectionId = ready.value.connectionId;
      this.scheduleDeclare(); // flush interest gathered before the id arrived
      // Reconcile the gap: no server replay, so pulse each watched ref `stale` and let the follower
      // refetch. Not on the first connect — the follower already loaded its state on open.
      if (reconnected) {
        for (const { ref } of this.interest.values()) this.nudges.next({ id: ref.id, stale: true });
      }
    });
    this.source.addEventListener('nudge', (e) => {
      // Drop a malformed frame rather than let the throw tear down the listener.
      safeJsonParse<NudgeDelta>((e as MessageEvent).data).map((delta) => {
        for (const entry of delta) this.nudges.next(entry);
      });
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
