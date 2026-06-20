import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { coordKey, MapDetail, MapSummary } from '@hexly/domain';
import { MapsStore } from './maps.store';

describe('MapsStore', () => {
  let store: MapsStore;
  let http: HttpTestingController;

  const aldermoor: MapDetail = {
    id: 'm1',
    ownerId: 'u1',
    title: 'Aldermoor',
    visibility: 'private',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    document: { hexes: {} },
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(MapsStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('creates a map by title and holds it as the open map', () => {
    store.create('Aldermoor').subscribe();

    const req = http.expectOne('/maps');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ title: 'Aldermoor' });
    req.flush(aldermoor);

    expect(store.current()).toEqual(aldermoor);
  });

  it('loads a map by id and holds it as the open map', () => {
    store.load('m1').subscribe();

    const req = http.expectOne('/maps/m1');
    expect(req.request.method).toBe('GET');
    req.flush(aldermoor);

    expect(store.current()).toEqual(aldermoor);
  });

  /** Open `aldermoor` (version 1) so save/conflict tests have a base version. */
  function openAldermoor() {
    store.load('m1').subscribe();
    http.expectOne('/maps/m1').flush(aldermoor);
  }

  it('saves the open document against its base version and advances it', () => {
    openAldermoor();
    const painted = { hexes: { [coordKey({ q: 0, r: 0 })]: { terrain: 'forest' as const } } };

    let outcome: unknown;
    store.save(painted).subscribe((o) => (outcome = o));

    const req = http.expectOne('/maps/m1');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ document: painted, version: 1 });

    const saved: MapDetail = { ...aldermoor, version: 2, document: painted };
    req.flush(saved);

    expect(outcome).toEqual({ status: 'saved', map: saved });
    // The open map now carries the new version, so the next save is built on it.
    expect(store.current()).toEqual(saved);
  });

  it('surfaces a 409 as a conflict and leaves the open map untouched', () => {
    openAldermoor();
    const painted = { hexes: { [coordKey({ q: 0, r: 0 })]: { terrain: 'forest' as const } } };

    // The server's current map has moved past our base version.
    const serverCurrent: MapDetail = {
      ...aldermoor,
      version: 5,
      document: { hexes: { [coordKey({ q: 9, r: 9 })]: { terrain: 'ocean' } } },
    };

    let outcome: unknown;
    store.save(painted).subscribe((o) => (outcome = o));

    http
      .expectOne('/maps/m1')
      .flush(serverCurrent, { status: 409, statusText: 'Conflict' });

    // The save is reported as a conflict carrying the server's current map...
    expect(outcome).toEqual({ status: 'conflict', current: serverCurrent });
    expect(store.conflict()).toEqual(serverCurrent);
    // ...and the open map is unchanged — still version 1 — so the edit is not
    // silently lost and the user can re-pull from the surfaced conflict.
    expect(store.current()).toEqual(aldermoor);
  });

  it('clears an outstanding conflict when a fresh load succeeds (re-pull)', () => {
    openAldermoor();
    const painted = { hexes: { [coordKey({ q: 0, r: 0 })]: { terrain: 'forest' as const } } };
    const serverCurrent: MapDetail = { ...aldermoor, version: 5 };

    // Provoke a conflict so there is one to clear.
    store.save(painted).subscribe();
    http
      .expectOne('/maps/m1')
      .flush(serverCurrent, { status: 409, statusText: 'Conflict' });
    expect(store.conflict()).not.toBeNull();

    // Re-pulling the map resolves the conflict.
    store.load('m1').subscribe();
    http.expectOne('/maps/m1').flush(serverCurrent);

    expect(store.conflict()).toBeNull();
  });

  it('renames a map and updates the open map when it is the one renamed', () => {
    openAldermoor();

    let result: MapDetail | undefined;
    store.rename('m1', 'The Whisperwood').subscribe((m) => (result = m));

    const req = http.expectOne('/maps/m1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ title: 'The Whisperwood' });

    const renamed: MapDetail = { ...aldermoor, title: 'The Whisperwood' };
    req.flush(renamed);

    expect(result).toEqual(renamed);
    expect(store.current()).toEqual(renamed);
  });

  it('deletes a map by id', () => {
    let completed = false;
    store.delete('m1').subscribe({ complete: () => (completed = true) });

    const req = http.expectOne('/maps/m1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);

    expect(completed).toBe(true);
  });

  it('lists the maps available to the user', () => {
    const summaries: MapSummary[] = [
      {
        id: 'm1',
        ownerId: 'u1',
        title: 'Aldermoor',
        visibility: 'private',
        version: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    let listed: MapSummary[] | undefined;
    store.list().subscribe((maps) => (listed = maps));

    const req = http.expectOne('/maps');
    expect(req.request.method).toBe('GET');
    req.flush(summaries);

    expect(listed).toEqual(summaries);
  });
});
