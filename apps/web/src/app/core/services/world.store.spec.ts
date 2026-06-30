import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { WorldDetail, WorldSummary } from '@hexly/domain';
import { AuthClient } from './auth.client';
import { MockAuthClient } from '../testing/auth-client.mock';
import { WorldsClient } from './worlds.client';
import { MockWorldsClient } from '../testing/worlds-client.mock';
import { WorldStore } from './world.store';

function world(id: string, name = id): WorldSummary {
  return { id, name, ownerId: 'u1', createdAt: 1, updatedAt: 1 };
}

describe('WorldStore', () => {
  let store: WorldStore;
  let worldsClient: MockWorldsClient;
  let auth: MockAuthClient;

  beforeEach(() => {
    worldsClient = new MockWorldsClient();
    auth = new MockAuthClient();
    TestBed.configureTestingModule({
      providers: [
        { provide: WorldsClient, useValue: worldsClient },
        { provide: AuthClient, useValue: auth },
      ],
    });
    store = TestBed.inject(WorldStore);
  });

  function flushList(worlds: WorldSummary[]): void {
    worldsClient.list.mockReturnValue(of(worlds));
  }

  function login(id = 'u1'): void {
    auth.setUser({ id, email: 'ada@hexly.test', displayName: 'Ada' });
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

  it('creating a World appends it and returns its detail', () => {
    flushList([world('w1')]);
    store.load();

    const detail: WorldDetail = {
      ...world('w2', 'New Realm'),
      homeEntityId: 'e2',
      entityCount: 1,
    };
    worldsClient.create.mockReturnValue(of(detail));

    let created: WorldDetail | undefined;
    store.create('New Realm').subscribe((w) => (created = w));

    expect(created).toEqual(detail);
    expect(store.worlds().map((w) => w.id)).toEqual(['w1', 'w2']);
  });

  it('forgets the loaded Worlds when the authenticated user changes', () => {
    login('u1');
    TestBed.flushEffects();
    flushList([world('w1')]);
    store.load();
    expect(store.worlds()).toHaveLength(1);

    // Logout clears the user — the next user must not see u1's Worlds.
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

    // Re-login as the same user (fresh object, same id) must not wipe the list —
    // the always-mounted switcher relies on having loaded once.
    login('u1');
    TestBed.flushEffects();

    expect(store.worlds()).toHaveLength(1);
    expect(store.loaded()).toBe(true);
  });
});
