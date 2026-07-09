import { Observable, of } from 'rxjs';
import { NudgeBusClient } from './nudge-bus.client';
import { MockNudgeBusClient } from '../testing/nudge-bus.mock';
import { FollowStore } from './follow-store';
import { EVICTED } from './live-follow';

const ID = 'r1';
const DEBOUNCE = 10;

/** Any followed resource: an id and the freshness key `seq` (ADR-0045). */
interface Doc {
  id: string;
  seq: number;
  name?: string;
}

const doc = (seq: number, name = 'Aldermoor'): Doc => ({ id: ID, seq, name });

/** Flush the microtask the store defers its write-through fanout onto. */
const flushMicrotasks = () => Promise.resolve();

describe('FollowStore', () => {
  let bus: MockNudgeBusClient;
  let store: FollowStore<Doc>;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new MockNudgeBusClient();
    store = new FollowStore<Doc>(bus as unknown as NudgeBusClient, {
      kind: 'entity',
      debounceMs: DEBOUNCE,
    });
  });

  afterEach(() => vi.useRealTimers());

  function watch(fetch: () => Observable<Doc>) {
    const seen: unknown[] = [];
    const sub = store.watch(ID, fetch).subscribe((r) => seen.push(r));
    return { seen, sub };
  }

  it('follows the configured ref kind and refetches on a readable nudge', () => {
    const fetch = vi.fn(() => of(doc(2)));
    const { seen } = watch(fetch);
    expect(bus.follow).toHaveBeenCalledWith({ kind: 'entity', id: ID });

    bus.emit({ id: ID, seq: 2 });
    vi.advanceTimersByTime(DEBOUNCE);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([doc(2)]);
  });

  it('dedups a nudge no newer than the held seq (self-echo, automatic)', () => {
    const fetch = vi.fn(() => of(doc(9)));
    watch(fetch);
    store.merge(doc(3)); // a prior read/write seeded held at seq 3

    bus.emit({ id: ID, seq: 3 }); // the server echoes that very write
    vi.advanceTimersByTime(DEBOUNCE);

    expect(fetch).not.toHaveBeenCalled(); // no roundtrip
  });

  it('emits EVICTED on an unavailable nudge without fetching', () => {
    const fetch = vi.fn(() => of(doc(2)));
    const { seen } = watch(fetch);

    bus.emit({ id: ID, unavailable: true });

    expect(seen).toEqual([EVICTED]);
    expect(fetch).not.toHaveBeenCalled();
  });

  /**
   * An eviction must never be freshness-gated. It carries no `seq`, so a follower holding a high
   * `seq` would otherwise swallow the one signal that tells it its access is gone.
   */
  it('evicts even when the held seq is far ahead of anything the server could send', () => {
    const fetch = vi.fn(() => of(doc(2)));
    const { seen } = watch(fetch);
    store.merge(doc(999));

    bus.emit({ id: ID, unavailable: true });

    expect(seen).toEqual([EVICTED]);
  });

  // The point of the write-through store: a local save reaches every watcher with no roundtrip.
  it('fans a write-through merge out to every watcher, on a microtask, without any fetch', async () => {
    const fetchA = vi.fn(() => of(doc(1)));
    const fetchB = vi.fn(() => of(doc(1)));
    const a = watch(fetchA);
    const b = watch(fetchB);
    expect(bus.follow).toHaveBeenCalledTimes(1); // two watchers share one follow

    store.merge(doc(5, 'Saved'));
    expect(a.seen).toEqual([]); // deferred, not synchronous
    expect(b.seen).toEqual([]);

    await flushMicrotasks();

    expect(a.seen).toEqual([doc(5, 'Saved')]);
    expect(b.seen).toEqual([doc(5, 'Saved')]);
    expect(fetchA).not.toHaveBeenCalled();
    expect(fetchB).not.toHaveBeenCalled();
  });

  it('advances held monotonically — a late/stale read cannot regress it', () => {
    const fetch = vi.fn(() => of(doc(9)));
    watch(fetch);

    store.merge(doc(5)); // held → seq 5
    store.merge(doc(3)); // a stale read resolving late must not drag held back to seq 3

    bus.emit({ id: ID, seq: 4 }); // still older than the seq 5 we hold
    vi.advanceTimersByTime(DEBOUNCE);

    expect(fetch).not.toHaveBeenCalled();
  });

  /**
   * A `stale` pulse is client-minted on reconnect and carries no `seq`: the client cannot know
   * what changed during the gap, so it must refetch unconditionally rather than be gated out.
   */
  it('always refetches on a stale reconnect pulse, however high the held seq', () => {
    const fetch = vi.fn(() => of(doc(9)));
    watch(fetch);
    store.merge(doc(5));

    bus.emit({ id: ID, stale: true });
    vi.advanceTimersByTime(DEBOUNCE);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  /**
   * The whole point of one `seq` on every resource kind (ADR-0045): a World store is the *same*
   * store with a different ref kind. There is no per-kind freshness adapter left to configure —
   * `FollowStoreConfig.isNewer` is gone, and the comparison lives in one place.
   */
  it('gates a World exactly as it gates an Entity — one comparison, no per-kind adapter', () => {
    const worlds = new FollowStore<Doc>(bus as unknown as NudgeBusClient, {
      kind: 'world',
      debounceMs: DEBOUNCE,
    });
    const fetch = vi.fn(() => of(doc(9)));
    worlds.watch(ID, fetch).subscribe();
    expect(bus.follow).toHaveBeenCalledWith({ kind: 'world', id: ID });

    worlds.merge(doc(5));
    bus.emit({ id: ID, seq: 5 }); // same seq → not newer
    vi.advanceTimersByTime(DEBOUNCE);
    expect(fetch).not.toHaveBeenCalled();

    bus.emit({ id: ID, seq: 6 }); // strictly newer → one refetch
    vi.advanceTimersByTime(DEBOUNCE);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
