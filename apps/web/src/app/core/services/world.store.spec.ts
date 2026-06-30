import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom, of, throwError } from 'rxjs';
import { AuthUser, WorldDetail, WorldSummary } from '@hexly/domain';
import { AuthClient } from './auth.client';
import { WorldsClient } from './worlds.client';
import { MockAuthClient } from '../testing/mock-auth-client';
import { MockWorldsClient } from '../testing/mock-worlds-client';
import { WorldStore } from './world.store';

function summary(id: string, name = id): WorldSummary {
  return { id, name, ownerId: 'u1', createdAt: 1, updatedAt: 1 };
}

function detail(id: string, name = id): WorldDetail {
  return { ...summary(id, name), homeEntityId: `home-${id}`, entityCount: 1 };
}

function user(id: string): AuthUser {
  return { id, email: `${id}@hexly.test`, displayName: id };
}

describe('WorldStore', () => {
  let store: WorldStore;
  let worlds: MockWorldsClient;
  let auth: MockAuthClient;

  beforeEach(() => {
    worlds = new MockWorldsClient();
    auth = new MockAuthClient();
    TestBed.configureTestingModule({
      providers: [
        { provide: WorldsClient, useValue: worlds },
        { provide: AuthClient, useValue: auth },
        provideRouter([]),
      ],
    });
    store = TestBed.inject(WorldStore);
    // Settle the store's initial reset effect so a later load isn't wiped.
    TestBed.flushEffects();
  });

  it('loads the caller’s Worlds and marks loaded', () => {
    expect(store.loaded()).toBe(false);
    worlds.list.mockReturnValue(of([summary('w1', 'Aldermoor'), summary('w2', 'Whisperwood')]));
    store.load();

    expect(store.worlds().map((w) => w.id)).toEqual(['w1', 'w2']);
    expect(store.loaded()).toBe(true);
  });

  it('loads once — a second load() is a no-op while the first stands', () => {
    worlds.list.mockReturnValue(of([summary('w1')]));
    store.load();
    store.load();

    // No re-fetch: the store guards a second load while the first stands.
    expect(worlds.list).toHaveBeenCalledTimes(1);
    expect(store.worlds().map((w) => w.id)).toEqual(['w1']);
  });

  it('marks loaded and resets the guard on error so the next load() retries', () => {
    worlds.list.mockReturnValueOnce(throwError(() => new Error('down')));
    store.load();
    expect(store.loaded()).toBe(true);
    expect(store.loadError()).toBe(true);

    worlds.list.mockReturnValue(of([summary('w1')]));
    store.load();
    expect(store.worlds().map((w) => w.id)).toEqual(['w1']);
  });

  it('creating a World appends it and returns its detail', async () => {
    worlds.list.mockReturnValue(of([summary('w1')]));
    store.load();

    worlds.create.mockReturnValue(of(detail('w2', 'New Realm')));
    const created = await firstValueFrom(store.create('New Realm'));

    expect(created.name).toBe('New Realm');
    expect(created.entityCount).toBe(1);
    expect(store.worlds().map((w) => w.name).sort()).toEqual(['New Realm', 'w1']);
  });

  it('forgets the loaded Worlds when the authenticated user changes', () => {
    auth.setUser(user('u1'));
    TestBed.flushEffects();
    worlds.list.mockReturnValue(of([summary('w1')]));
    store.load();
    expect(store.worlds()).toHaveLength(1);

    // Logout clears the user — the next user must not see u1's Worlds.
    auth.setUser(null);
    TestBed.flushEffects();

    expect(store.worlds()).toEqual([]);
    expect(store.loaded()).toBe(false);
  });

  it('keeps the loaded Worlds when the same user logs in again (e.g. a re-auth)', () => {
    auth.setUser(user('u1'));
    TestBed.flushEffects();
    worlds.list.mockReturnValue(of([summary('w1')]));
    store.load();
    expect(store.worlds()).toHaveLength(1);

    // Re-login as the same user (fresh object, same id) must not wipe the list —
    // the always-mounted switcher relies on having loaded once.
    auth.setUser(user('u1'));
    TestBed.flushEffects();

    expect(store.worlds()).toHaveLength(1);
    expect(store.loaded()).toBe(true);
  });
});
