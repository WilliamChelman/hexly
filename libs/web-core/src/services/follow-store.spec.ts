import { Observable, of } from 'rxjs';
import { NudgeBusClient } from './nudge-bus.client';
import { MockNudgeBusClient } from '../testing/nudge-bus.mock';
import { FollowStore } from './follow-store';
import { EVICTED } from './live-follow';

const ID = 'r1';
const DEBOUNCE = 10;

/** A versioned resource (Entity-shaped): version, then updatedAt. */
interface Doc {
  id: string;
  version: number;
  updatedAt: number;
  name?: string;
}
type DocNudge = { id: string; version: number; updatedAt: number };

const doc = (version: number, updatedAt = version, name = 'Aldermoor'): Doc => ({
  id: ID,
  version,
  updatedAt,
  name,
});

/** Flush the microtask the store defers its write-through fanout onto. */
const flushMicrotasks = () => Promise.resolve();

describe('FollowStore', () => {
  let bus: MockNudgeBusClient;
  let store: FollowStore<Doc, DocNudge>;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new MockNudgeBusClient();
    store = new FollowStore<Doc, DocNudge>(bus as unknown as NudgeBusClient, {
      kind: 'entity',
      debounceMs: DEBOUNCE,
      isNewer: (a, b) => a.version > b.version || (a.version === b.version && a.updatedAt > b.updatedAt),
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

    bus.emit({ id: ID, version: 2, updatedAt: 2 });
    vi.advanceTimersByTime(DEBOUNCE);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([doc(2)]);
  });

  it('dedups a nudge no newer than the held version (self-echo, automatic)', async () => {
    const fetch = vi.fn(() => of(doc(9)));
    const { seen } = watch(fetch);
    store.merge(doc(3)); // a prior read/write seeded held at v3
    await flushMicrotasks();
    seen.length = 0;

    bus.emit({ id: ID, version: 3, updatedAt: 3 }); // the server echoes that very write
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

  // The point of the write-through store: a local save reaches every watcher with no roundtrip.
  it('fans a write-through merge out to every watcher, on a microtask, without any fetch', async () => {
    const fetchA = vi.fn(() => of(doc(1)));
    const fetchB = vi.fn(() => of(doc(1)));
    const a = watch(fetchA);
    const b = watch(fetchB);
    expect(bus.follow).toHaveBeenCalledTimes(1); // two watchers share one follow

    store.merge(doc(5, 5, 'Saved'));
    expect(a.seen).toEqual([]); // deferred, not synchronous
    expect(b.seen).toEqual([]);

    await flushMicrotasks();

    expect(a.seen).toEqual([doc(5, 5, 'Saved')]);
    expect(b.seen).toEqual([doc(5, 5, 'Saved')]);
    expect(fetchA).not.toHaveBeenCalled();
    expect(fetchB).not.toHaveBeenCalled();
  });

  it('advances held monotonically — a late/stale read cannot regress it', async () => {
    const fetch = vi.fn(() => of(doc(9)));
    watch(fetch);

    store.merge(doc(5)); // held → v5
    store.merge(doc(3)); // a stale read resolving late must not drag held back to v3
    await flushMicrotasks();

    bus.emit({ id: ID, version: 4, updatedAt: 4 }); // still older than the v5 we hold
    vi.advanceTimersByTime(DEBOUNCE);

    expect(fetch).not.toHaveBeenCalled();
  });

  it('is generic over freshness — a World-shaped store (updatedAt only) dedups a same-updatedAt nudge', async () => {
    interface World {
      id: string;
      updatedAt: number;
    }
    const worlds = new FollowStore<World, { id: string; updatedAt: number }>(
      bus as unknown as NudgeBusClient,
      { kind: 'world', debounceMs: DEBOUNCE, isNewer: (a, b) => a.updatedAt > b.updatedAt },
    );
    const fetch = vi.fn(() => of({ id: ID, updatedAt: 9 }));
    worlds.watch(ID, fetch).subscribe();
    expect(bus.follow).toHaveBeenCalledWith({ kind: 'world', id: ID });

    worlds.merge({ id: ID, updatedAt: 5 });
    await flushMicrotasks();
    bus.emit({ id: ID, updatedAt: 5 }); // same updatedAt → not newer

    vi.advanceTimersByTime(DEBOUNCE);
    expect(fetch).not.toHaveBeenCalled();
  });
});
