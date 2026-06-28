import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { WorldDetail, WorldSummary } from '@hexly/domain';
import { WorldStore } from './world.store';

function world(id: string, name = id): WorldSummary {
  return { id, name, ownerId: 'u1', createdAt: 1, updatedAt: 1 };
}

describe('WorldStore', () => {
  let store: WorldStore;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(WorldStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  function flushList(worlds: WorldSummary[]): void {
    http.expectOne('/api/worlds').flush(worlds);
  }

  it('loads the worlds and activates the first when nothing is remembered', () => {
    store.load();
    flushList([world('w1', 'Aldermoor'), world('w2', 'Whisperwood')]);

    expect(store.worlds().map((w) => w.id)).toEqual(['w1', 'w2']);
    expect(store.activeWorldId()).toBe('w1');
    expect(store.activeWorld()?.name).toBe('Aldermoor');
  });

  it('restores the remembered active World when it is still present', () => {
    store.setActive('w2');
    store.load();
    flushList([world('w1'), world('w2'), world('w3')]);

    expect(store.activeWorldId()).toBe('w2');
  });

  it('falls back to the first World when the remembered one is gone', () => {
    store.setActive('missing');
    store.load();
    flushList([world('w1'), world('w2')]);

    expect(store.activeWorldId()).toBe('w1');
  });

  it('persists the active World via setActive', () => {
    store.setActive('w7');
    // The same singleton carries the selection in memory.
    const reborn = TestBed.inject(WorldStore);
    expect(reborn.activeWorldId()).toBe('w7');
  });

  it('marks loaded after a successful fetch', () => {
    expect(store.loaded()).toBe(false);
    store.load();
    flushList([world('w1')]);
    expect(store.loaded()).toBe(true);
  });

  it('marks loaded and resets hasLoaded on network error so the next load() retries', () => {
    store.load();
    http.expectOne('/api/worlds').flush(null, { status: 503, statusText: 'Service Unavailable' });

    expect(store.loaded()).toBe(true);
    // Second load() must retry — the error reset the guard.
    store.load();
    flushList([world('w1')]);
    expect(store.activeWorldId()).toBe('w1');
  });

  it('creating a World appends it and switches to it', () => {
    store.load();
    flushList([world('w1')]);

    let created: WorldDetail | undefined;
    store.create('New Realm').subscribe((w) => (created = w));
    const detail: WorldDetail = { ...world('w2', 'New Realm'), homeEntityId: 'e2' };
    http.expectOne('/api/worlds').flush(detail);

    expect(created).toEqual(detail);
    expect(store.worlds().map((w) => w.id)).toEqual(['w1', 'w2']);
    expect(store.activeWorldId()).toBe('w2');
  });
});
