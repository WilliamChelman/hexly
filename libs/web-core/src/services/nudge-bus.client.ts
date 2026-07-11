import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { EMPTY, Observable, Subject, catchError, filter } from 'rxjs';
import { ConnectionReady, FollowSignal, InterestRef, NudgeDelta } from '@hexly/domain';

/**
 * The client half of the live-follow nudge bus. Opens one multiplexed SSE stream
 * (`GET /api/events`) for the whole tab, captures the `connectionId` its first frame
 * mints, and declares the *whole* interest set via `PUT /api/events/:connectionId/interest`.
 *
 * Interest is subscription-scoped: {@link follow} returns the nudge stream for one ref, and
 * *subscribing* is what declares interest — unsubscribing withdraws it. A ref is
 * reference-counted, so N followers share one server-side subscription and only the last to
 * leave withdraws it. The stream opens lazily on the first follower — a tab watching nothing
 * holds no connection. An entry is either a `{ id, version }` delta or an opaque
 * `{ id, unavailable }` eviction — the bus relays both; what eviction means is the
 * follower's business.
 */
@Injectable({ providedIn: 'root' })
export class NudgeBusClient {
  private readonly http = inject(HttpClient);

  private source: EventSource | null = null;
  private connectionId: string | null = null;
  /**
   * The anonymous Public Link token this tab connects as, or null for a cookie principal.
   * When set it rides the `EventSource` URL and the interest `PUT` as `?token=` — the
   * token *is* the grant.
   */
  private token: string | null = null;
  /** Live interest, reference-counted per ref key, so shared follows don't clobber each other. */
  private readonly interest = new Map<string, { ref: InterestRef; count: number }>();
  /** Coalesce flag: many acquire/release calls in one turn collapse to a single interest flush. */
  private declareScheduled = false;

  /** Server nudges plus the client's own `stale` reconnect pulses (#177) — the follow stream. */
  private readonly nudges = new Subject<FollowSignal>();

  /**
   * Connect as an anonymous Public Link token principal instead of a session cookie;
   * `null` reverts to the cookie principal. Changing the token reopens the stream so
   * the new principal takes effect.
   */
  useToken(token: string | null): void {
    if (token === this.token) return;
    this.token = token;
    if (this.source) {
      // Reopen under the new principal, preserving the declared interest set.
      this.source.close();
      this.source = null;
      this.connectionId = null;
      this.ensureOpen();
      this.scheduleDeclare();
    }
  }

  /**
   * The stream of nudges for one resource. Subscribing declares interest (and opens the
   * connection if this is the first follower); unsubscribing withdraws it once the last
   * follower leaves — teardown handles withdrawal.
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
    // Relative URL → same origin, so the session cookie rides automatically. An
    // anonymous Public Link viewer has no cookie, so its token rides the URL instead.
    this.source = new EventSource('/api/events' + this.tokenQuery());
    this.source.addEventListener('ready', (e) => {
      // A `ready` while we already hold a connectionId is a *gap reconnect* on the same
      // EventSource (native auto-reconnect), not the first handshake — the mint differs each open.
      const reconnected = this.connectionId !== null;
      this.connectionId = (JSON.parse((e as MessageEvent).data) as ConnectionReady).connectionId;
      this.scheduleDeclare(); // flush interest gathered before the id arrived
      // Reconcile the gap: no server replay, so pulse each watched ref `stale` and let the follower
      // refetch. Not on the first connect — the follower already loaded its state on open.
      if (reconnected) {
        for (const { ref } of this.interest.values()) this.nudges.next({ id: ref.id, stale: true });
      }
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

  /** `?token=…` for an anonymous principal, or '' for a cookie one — appended to both wire calls. */
  private tokenQuery(): string {
    return this.token ? `?token=${encodeURIComponent(this.token)}` : '';
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
      .put<void>(`/api/events/${this.connectionId}/interest${this.tokenQuery()}`, {
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
