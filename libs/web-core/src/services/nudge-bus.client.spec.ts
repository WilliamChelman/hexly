import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { NudgeBusClient } from './nudge-bus.client';

/**
 * Stand-in for the browser's EventSource (absent in jsdom). Captures listeners so a test can
 * fire the server's `ready`/`nudge` frames, and records `close()` so idle-close is observable.
 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly listeners = new Map<string, (e: { data: string }) => void>();
  closed = false;
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, cb: (e: { data: string }) => void) {
    this.listeners.set(type, cb);
  }
  close() {
    this.closed = true;
  }
  fire(type: string, data: unknown) {
    this.listeners.get(type)?.({ data: JSON.stringify(data) });
  }
}

describe('NudgeBusClient', () => {
  let client: NudgeBusClient;
  let http: HttpTestingController;

  beforeEach(() => {
    FakeEventSource.instances = [];
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    client = TestBed.inject(NudgeBusClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    delete (globalThis as unknown as { EventSource?: unknown }).EventSource;
  });

  const entity = (id: string) => ({ kind: 'entity' as const, id });

  /** Fire the handshake on the (single) open stream and drain the coalescing microtask. */
  async function ready(connectionId: string) {
    FakeEventSource.instances[0].fire('ready', { connectionId });
    await Promise.resolve();
  }

  it('declares interest once for two followers of the same ref, closing only when the last leaves', async () => {
    const s1 = client.follow(entity('X')).subscribe();
    const s2 = client.follow(entity('X')).subscribe();
    await ready('c1');

    // One connection, one PUT carrying the single ref — the second follow didn't re-declare.
    expect(FakeEventSource.instances.length).toBe(1);
    const put = http.expectOne('/api/events/c1/interest');
    expect(put.request.body).toEqual({ refs: [entity('X')] });
    put.flush(null);

    // First unsubscribe: another follower remains → no wire change, connection stays open.
    s1.unsubscribe();
    await Promise.resolve();
    http.expectNone('/api/events/c1/interest');
    expect(FakeEventSource.instances[0].closed).toBe(false);

    // Last unsubscribe: interest empties → idle-close, no dangling PUT.
    s2.unsubscribe();
    await Promise.resolve();
    expect(FakeEventSource.instances[0].closed).toBe(true);
    http.expectNone('/api/events/c1/interest');
  });

  it('coalesces a follow-swap into a single PUT with the final ref', async () => {
    const a = client.follow(entity('A')).subscribe();
    await ready('c1');
    http.expectOne('/api/events/c1/interest').flush(null); // initial [A]

    // Swap A→B in one turn, as switchMap teardown+resubscribe does. One PUT, final set only —
    // never a stray empty-set PUT that could land last and clear interest.
    a.unsubscribe();
    const b = client.follow(entity('B')).subscribe();
    await Promise.resolve();

    const put = http.expectOne('/api/events/c1/interest');
    expect(put.request.body).toEqual({ refs: [entity('B')] });
    put.flush(null);
    // The connection was reused across the swap, not churned.
    expect(FakeEventSource.instances.length).toBe(1);

    b.unsubscribe();
    await Promise.resolve(); // idle-close, no PUT
  });

  it('carries ?token= on the stream and interest for an anonymous principal, and reverts on useToken(null)', async () => {
    // Anonymous Public Link viewer (#175): the token rides the EventSource URL and the PUT.
    client.useToken('abc');
    client.follow(entity('X')).subscribe();
    await ready('c1');
    expect(FakeEventSource.instances[0].url).toBe('/api/events?token=abc');
    http.expectOne('/api/events/c1/interest?token=abc').flush(null);

    // Reverting to the cookie principal (route leave) reopens the stream with no token, so the
    // shared singleton bus can't stay pinned to a link on an authenticated page.
    client.useToken(null);
    expect(FakeEventSource.instances[0].closed).toBe(true);
    await ready('c2');
    expect(FakeEventSource.instances[1].url).toBe('/api/events');
    http.expectOne('/api/events/c2/interest').flush(null);
  });

  it('re-declares the full interest set when the stream reconnects (fresh connectionId)', async () => {
    // The native EventSource auto-reconnects across a gap; the server mints a fresh id on the new
    // handshake. The client must re-PUT its whole watched set against the new id, or nudges stop.
    client.follow(entity('X')).subscribe();
    client.follow(entity('Y')).subscribe();
    await ready('c1');
    http.expectOne('/api/events/c1/interest').flush(null);

    // Same EventSource, a second `ready` = a reconnect handshake with a new connectionId.
    FakeEventSource.instances[0].fire('ready', { connectionId: 'c2' });
    await Promise.resolve();

    const put = http.expectOne('/api/events/c2/interest');
    expect(put.request.body).toEqual({ refs: [entity('X'), entity('Y')] });
    put.flush(null);
    // Reconnect reused the connection, not churned it.
    expect(FakeEventSource.instances.length).toBe(1);
  });

  it('emits a stale pulse for each watched ref on reconnect, so followers reconcile the gap', async () => {
    // Reconnect-and-refetch is how a gap heals (ADR-0044): no server replay. On the reconnect
    // handshake the client pulses each watched ref `{ id, stale: true }` so its follower refetches
    // and picks up whatever changed while the socket was down.
    const x: unknown[] = [];
    const y: unknown[] = [];
    client.follow(entity('X')).subscribe((n) => x.push(n));
    client.follow(entity('Y')).subscribe((n) => y.push(n));
    await ready('c1');
    http.expectOne('/api/events/c1/interest').flush(null);
    // Nothing fires on the *first* connect — the followers already loaded their state on open.
    expect(x).toEqual([]);
    expect(y).toEqual([]);

    FakeEventSource.instances[0].fire('ready', { connectionId: 'c2' });
    await Promise.resolve();
    http.expectOne('/api/events/c2/interest').flush(null);

    expect(x).toEqual([{ id: 'X', stale: true }]);
    expect(y).toEqual([{ id: 'Y', stale: true }]);
  });

  it('delivers nudges only to the matching follower', async () => {
    const seen: unknown[] = [];
    client.follow(entity('X')).subscribe((n) => seen.push(n));
    await ready('c1');
    http.expectOne('/api/events/c1/interest').flush(null);

    FakeEventSource.instances[0].fire('nudge', [{ id: 'X', version: 7, updatedAt: 1 }]);
    FakeEventSource.instances[0].fire('nudge', [{ id: 'other', version: 9, updatedAt: 1 }]);

    expect(seen).toEqual([{ id: 'X', version: 7, updatedAt: 1 }]);
  });
});
