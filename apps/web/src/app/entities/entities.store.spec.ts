import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  coordKey,
  emptyContent,
  EntityBody,
  EntityDetail,
  EntitySummary,
} from '@hexly/domain';
import { EntitiesStore } from './entities.store';

/** An empty hexmap body — the shape the editor round-trips through the store. */
const emptyHexmapBody: EntityBody = {
  type: 'hexmap',
  content: emptyContent(),
  hexes: {},
  regions: [],
  labels: [],
};

describe('EntitiesStore', () => {
  let store: EntitiesStore;
  let http: HttpTestingController;

  const aldermoor: EntityDetail = {
    id: 'e1',
    ownerId: 'u1',
    name: 'Aldermoor',
    type: 'hexmap',
    tags: [],
    visibility: 'private',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
    document: emptyHexmapBody,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(EntitiesStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('creates an entity by name and type and holds it as the open entity', () => {
    store.create('Aldermoor', 'hexmap').subscribe();

    const req = http.expectOne('/entities');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'Aldermoor', type: 'hexmap' });
    req.flush(aldermoor);

    expect(store.current()).toEqual(aldermoor);
  });

  it('loads an entity by id and holds it as the open entity', () => {
    store.load('e1').subscribe();

    const req = http.expectOne('/entities/e1');
    expect(req.request.method).toBe('GET');
    req.flush(aldermoor);

    expect(store.current()).toEqual(aldermoor);
  });

  /** Open `aldermoor` (version 1) so save/conflict tests have a base version. */
  function openAldermoor() {
    store.load('e1').subscribe();
    http.expectOne('/entities/e1').flush(aldermoor);
  }

  it('saves the open body against its base version and advances it', () => {
    openAldermoor();
    const painted: EntityBody = {
      ...emptyHexmapBody,
      hexes: { [coordKey({ q: 0, r: 0 })]: { terrain: 'forest' } },
    };

    let outcome: unknown;
    store.save(painted).subscribe((o) => (outcome = o));

    const req = http.expectOne('/entities/e1');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ document: painted, version: 1 });

    const saved: EntityDetail = { ...aldermoor, version: 2, document: painted };
    req.flush(saved);

    expect(outcome).toEqual({ status: 'saved', entity: saved });
    // The open entity now carries the new version, so the next save builds on it.
    expect(store.current()).toEqual(saved);
  });

  it('surfaces a 409 as a conflict and leaves the open entity untouched', () => {
    openAldermoor();
    const painted: EntityBody = {
      ...emptyHexmapBody,
      hexes: { [coordKey({ q: 0, r: 0 })]: { terrain: 'forest' } },
    };
    const serverCurrent: EntityDetail = { ...aldermoor, version: 5 };

    let outcome: unknown;
    store.save(painted).subscribe((o) => (outcome = o));

    http
      .expectOne('/entities/e1')
      .flush(serverCurrent, { status: 409, statusText: 'Conflict' });

    expect(outcome).toEqual({ status: 'conflict', current: serverCurrent });
    expect(store.conflict()).toEqual(serverCurrent);
    // The open entity is unchanged — still version 1 — so the edit isn't lost.
    expect(store.current()).toEqual(aldermoor);
  });

  it('clears an outstanding conflict when a fresh load succeeds (re-pull)', () => {
    openAldermoor();
    const serverCurrent: EntityDetail = { ...aldermoor, version: 5 };

    store.save(emptyHexmapBody).subscribe();
    http
      .expectOne('/entities/e1')
      .flush(serverCurrent, { status: 409, statusText: 'Conflict' });
    expect(store.conflict()).not.toBeNull();

    store.load('e1').subscribe();
    http.expectOne('/entities/e1').flush(serverCurrent);

    expect(store.conflict()).toBeNull();
  });

  it('renames an entity and updates the open entity when it is the one renamed', () => {
    openAldermoor();

    let result: EntityDetail | undefined;
    store.rename('e1', 'The Whisperwood').subscribe((e) => (result = e));

    const req = http.expectOne('/entities/e1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: 'The Whisperwood' });

    const renamed: EntityDetail = { ...aldermoor, name: 'The Whisperwood' };
    req.flush(renamed);

    expect(result).toEqual(renamed);
    expect(store.current()).toEqual(renamed);
  });

  /** Provoke a save conflict on the open entity so there is one to clear. */
  function provokeConflict() {
    store.save(emptyHexmapBody).subscribe();
    http
      .expectOne('/entities/e1')
      .flush({ ...aldermoor, version: 5 }, { status: 409, statusText: 'Conflict' });
    expect(store.conflict()).not.toBeNull();
  }

  it('clears an outstanding conflict when the open entity is successfully renamed', () => {
    openAldermoor();
    provokeConflict();

    store.rename('e1', 'The Whisperwood').subscribe();
    http.expectOne('/entities/e1').flush({ ...aldermoor, name: 'The Whisperwood' });

    expect(store.conflict()).toBeNull();
  });

  it('clears an outstanding conflict when a new entity is created', () => {
    openAldermoor();
    provokeConflict();

    store.create('A new world', 'hexmap').subscribe();
    http
      .expectOne('/entities')
      .flush({ ...aldermoor, id: 'e2', name: 'A new world' });

    expect(store.conflict()).toBeNull();
  });

  it('deletes an entity by id', () => {
    let completed = false;
    store.delete('e1').subscribe({ complete: () => (completed = true) });

    const req = http.expectOne('/entities/e1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);

    expect(completed).toBe(true);
  });

  it('clears the open entity and any conflict when the open entity is deleted', () => {
    openAldermoor();
    provokeConflict();

    store.delete('e1').subscribe();
    http.expectOne('/entities/e1').flush(null);

    expect(store.current()).toBeNull();
    expect(store.conflict()).toBeNull();
  });

  it('lists the entities available to the user', () => {
    const summaries: EntitySummary[] = [
      {
        id: 'e1',
        ownerId: 'u1',
        name: 'Aldermoor',
        type: 'hexmap',
        tags: [],
        visibility: 'private',
        version: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    let listed: EntitySummary[] | undefined;
    store.list().subscribe((entities) => (listed = entities));

    const req = http.expectOne('/entities');
    expect(req.request.method).toBe('GET');
    req.flush(summaries);

    expect(listed).toEqual(summaries);
  });
});
