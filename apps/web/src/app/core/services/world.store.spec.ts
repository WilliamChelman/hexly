import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { WorldDetail, WorldSummary } from '@hexly/domain';
import { AuthClient } from './auth.client';
import { makeUser, provideFakeTrailbase } from '../testing/fake-trailbase-client';
import { WorldStore } from './world.store';

function world(id: string, name = id): WorldSummary {
  return { id, name, ownerId: 'u1', createdAt: 1, updatedAt: 1 };
}

describe('WorldStore', () => {
  let store: WorldStore;
  let http: HttpTestingController;
  let tb: ReturnType<typeof provideFakeTrailbase>;

  beforeEach(() => {
    tb = provideFakeTrailbase();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), tb.provider, provideRouter([])],
    });
    store = TestBed.inject(WorldStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    // A fake-backed login persists a token (via the real onAuthChange); clear it
    // so it can't leak into another spec's session.
    localStorage.clear();
  });

  function flushList(worlds: WorldSummary[]): void {
    http.expectOne('/api/worlds').flush(worlds);
  }

  async function login(id = 'u1'): Promise<void> {
    tb.client.nextLogin = { user: makeUser(id, 'ada@hexly.test') };
    await firstValueFrom(TestBed.inject(AuthClient).login('ada@hexly.test', 'pw'));
  }

  it('loads the caller’s Worlds and marks loaded', () => {
    expect(store.loaded()).toBe(false);
    store.load();
    flushList([world('w1', 'Aldermoor'), world('w2', 'Whisperwood')]);

    expect(store.worlds().map((w) => w.id)).toEqual(['w1', 'w2']);
    expect(store.loaded()).toBe(true);
  });

  it('loads once — a second load() is a no-op while the first stands', () => {
    store.load();
    flushList([world('w1')]);
    store.load();
    http.expectNone('/api/worlds');
  });

  it('marks loaded and resets the guard on error so the next load() retries', () => {
    store.load();
    http
      .expectOne('/api/worlds')
      .flush(null, { status: 503, statusText: 'Service Unavailable' });

    expect(store.loaded()).toBe(true);
    store.load();
    flushList([world('w1')]);
    expect(store.worlds().map((w) => w.id)).toEqual(['w1']);
  });

  it('creating a World appends it and returns its detail', () => {
    store.load();
    flushList([world('w1')]);

    let created: WorldDetail | undefined;
    store.create('New Realm').subscribe((w) => (created = w));
    const detail: WorldDetail = {
      ...world('w2', 'New Realm'),
      homeEntityId: 'e2',
      entityCount: 1,
    };
    http.expectOne('/api/worlds').flush(detail);

    expect(created).toEqual(detail);
    expect(store.worlds().map((w) => w.id)).toEqual(['w1', 'w2']);
  });

  it('forgets the loaded Worlds when the authenticated user changes', async () => {
    await login('u1');
    TestBed.flushEffects();
    store.load();
    flushList([world('w1')]);
    expect(store.worlds()).toHaveLength(1);

    // Logout clears the user — the next user must not see u1's Worlds.
    await firstValueFrom(TestBed.inject(AuthClient).logout());
    TestBed.flushEffects();

    expect(store.worlds()).toEqual([]);
    expect(store.loaded()).toBe(false);
  });

  it('keeps the loaded Worlds when the same user logs in again (e.g. a re-auth)', async () => {
    await login('u1');
    TestBed.flushEffects();
    store.load();
    flushList([world('w1')]);
    expect(store.worlds()).toHaveLength(1);

    // Re-login as the same user (fresh object, same id) must not wipe the list —
    // the always-mounted switcher relies on having loaded once.
    await login('u1');
    TestBed.flushEffects();

    expect(store.worlds()).toHaveLength(1);
    expect(store.loaded()).toBe(true);
  });
});
