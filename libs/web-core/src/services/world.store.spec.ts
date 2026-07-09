import { TestBed } from '@angular/core/testing';
import { merge, of, throwError } from 'rxjs';
import { WorldDetail, WorldSummary } from '@hexly/domain';
import { AuthClient } from './auth.client';
import { MockAuthClient } from '../testing/auth-client.mock';
import { WorldsClient, WORLD_NUDGE_DEBOUNCE_MS } from './worlds.client';
import { MockWorldsClient } from '../testing/worlds-client.mock';
import { NudgeBusClient } from './nudge-bus.client';
import { MockNudgeBusClient } from '../testing/nudge-bus.mock';
import { Logger } from './logger';
import { WorldStore } from './world.store';

function world(id: string, name = id): WorldSummary {
  return { id, name, owners: ['u1'], rights: ['read', 'manage'], createdAt: 1, updatedAt: 1 };
}

describe('WorldStore', () => {
  let store: WorldStore;
  let worldsClient: MockWorldsClient;
  let auth: MockAuthClient;
  let bus: MockNudgeBusClient;
  let logger: { error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    worldsClient = new MockWorldsClient();
    auth = new MockAuthClient();
    bus = new MockNudgeBusClient();
    // Relay the mock bus so the store's reconciler sees raw nudges, as WorldsClient.watchAll wires
    // in prod: the tests drive them via bus.emit and assert the list-level reconcile.
    worldsClient.watchAll.mockImplementation((ids) =>
      merge(...ids.map((id) => bus.follow({ kind: 'world', id }))),
    );
    logger = { error: vi.fn(), warn: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: WorldsClient, useValue: worldsClient },
        { provide: AuthClient, useValue: auth },
        { provide: NudgeBusClient, useValue: bus },
        { provide: Logger, useValue: logger },
      ],
    });
    store = TestBed.inject(WorldStore);
  });

  function flushList(worlds: WorldSummary[]): void {
    worldsClient.list.mockReturnValue(of(worlds));
  }

  function login(id = 'u1'): void {
    auth.setUser({ id, email: 'ada@hexly.test', displayName: 'Ada', preferences: {}, isAdmin: false, isSuperadmin: false, canCreateWorlds: true });
  }

  it('loads the caller’s Worlds and marks loaded', () => {
    expect(store.loaded()).toBe(false);
    flushList([world('w1', 'Aldermoor'), world('w2', 'Whisperwood')]);
    store.load();

    expect(store.worlds().map((w) => w.id)).toEqual(['w1', 'w2']);
    expect(store.loaded()).toBe(true);
  });

  it('loads once — a second load() is a no-op while the first stands', () => {
    flushList([world('w1')]);
    store.load();
    store.load();
    expect(worldsClient.list).toHaveBeenCalledTimes(1);
  });

  it('marks loaded and resets the guard on error so the next load() retries', () => {
    worldsClient.list.mockReturnValueOnce(throwError(() => new Error('unavailable')));
    store.load();

    expect(store.loaded()).toBe(true);
    flushList([world('w1')]);
    store.load();
    expect(store.worlds().map((w) => w.id)).toEqual(['w1']);
  });

  it('logs and keeps the last-good list when a re-focus refetch fails', () => {
    flushList([world('w1', 'Aldermoor')]);
    store.load();
    expect(store.worlds().map((w) => w.id)).toEqual(['w1']);

    worldsClient.list.mockReturnValue(throwError(() => new Error('offline')));
    store.refresh();

    // Stale-but-present beats a blank Index; the failure is logged, not swallowed.
    expect(store.worlds().map((w) => w.id)).toEqual(['w1']);
    expect(logger.error).toHaveBeenCalled();
  });

  it('creating a World appends the authoritative response and returns its detail', () => {
    flushList([world('w1')]);
    store.load();

    const detail: WorldDetail = {
      ...world('w2', 'New Realm'),
      entityCount: 1,
      pinnedEntityIds: [],
      seq: 1,
    };
    worldsClient.create.mockReturnValue(of(detail));

    let created: WorldDetail | undefined;
    store.create('New Realm').subscribe((w) => (created = w));

    // The acting tab reflects its own confirmed create at once — no dependence on a refetch.
    expect(created).toEqual(detail);
    expect(store.worlds().map((w) => w.id)).toEqual(['w1', 'w2']);
  });

  it('renaming a World reflects the acting tab’s own change in place at once', () => {
    flushList([world('w1', 'Aldermoor')]);
    store.load();
    worldsClient.rename.mockReturnValue(
      of({ ...world('w1', 'Aldermoor Reborn'), entityCount: 0, pinnedEntityIds: [], seq: 2 }),
    );

    store.rename('w1', 'Aldermoor Reborn').subscribe();

    expect(store.worlds().map((w) => w.name)).toEqual(['Aldermoor Reborn']);
  });

  it('deleting a World removes it from the list on the acting tab at once', () => {
    flushList([world('w1'), world('w2')]);
    store.load();
    worldsClient.delete.mockReturnValue(of(undefined));

    store.delete('w1').subscribe();

    expect(store.worlds().map((w) => w.id)).toEqual(['w2']);
  });

  it('forgets the loaded Worlds when the authenticated user changes', () => {
    login('u1');
    TestBed.flushEffects();
    flushList([world('w1')]);
    store.load();
    expect(store.worlds()).toHaveLength(1);

    auth.setUser(null);
    TestBed.flushEffects();

    expect(store.worlds()).toEqual([]);
    expect(store.loaded()).toBe(false);
  });

  it('keeps the loaded Worlds when the same user logs in again (e.g. a re-auth)', () => {
    login('u1');
    TestBed.flushEffects();
    flushList([world('w1')]);
    store.load();
    expect(store.worlds()).toHaveLength(1);

    login('u1');
    TestBed.flushEffects();

    expect(store.worlds()).toHaveLength(1);
    expect(store.loaded()).toBe(true);
  });

  /**
   * Live-follow reconciliation (ADR-0044, #176): the store follows the Worlds it holds and
   * reconciles from world nudges instead of hand-written optimistic in-place mutation.
   */
  describe('nudge reconciler', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    /** Load a list and settle the follow effect (`toObservable` subscribes async off the signal). */
    function loadAndFollow(worlds: WorldSummary[]): void {
      // Settle the user-change reset effect on the empty state *before* loading, else its first
      // flush would wipe the freshly-loaded list; then load and let the follow effect pick it up.
      TestBed.flushEffects();
      flushList(worlds);
      store.load();
      TestBed.flushEffects();
    }

    it('follows each held World so the server can nudge it', () => {
      loadAndFollow([world('w1'), world('w2')]);
      expect(bus.follow).toHaveBeenCalledWith({ kind: 'world', id: 'w1' });
      expect(bus.follow).toHaveBeenCalledWith({ kind: 'world', id: 'w2' });
    });

    it('refetches the list once after the debounce on a readable World nudge (rename elsewhere)', () => {
      loadAndFollow([world('w1', 'Aldermoor')]);
      // The refetch pulls the authoritative renamed list.
      flushList([world('w1', 'Aldermoor Reborn')]);
      worldsClient.list.mockClear();

      bus.emit({ id: 'w1', seq: 2 });
      expect(worldsClient.list).not.toHaveBeenCalled(); // debounced, not yet

      vi.advanceTimersByTime(WORLD_NUDGE_DEBOUNCE_MS);
      expect(worldsClient.list).toHaveBeenCalledTimes(1);
      expect(store.worlds().map((w) => w.name)).toEqual(['Aldermoor Reborn']);
    });

    it('drops a World from the list on an unavailable nudge (membership loss / delete), no refetch', () => {
      loadAndFollow([world('w1'), world('w2')]);
      worldsClient.list.mockClear();

      bus.emit({ id: 'w2', unavailable: true });

      expect(store.worlds().map((w) => w.id)).toEqual(['w1']);
      vi.advanceTimersByTime(WORLD_NUDGE_DEBOUNCE_MS);
      expect(worldsClient.list).not.toHaveBeenCalled();
    });
  });
});
