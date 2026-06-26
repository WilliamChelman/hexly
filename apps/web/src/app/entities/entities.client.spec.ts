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
import { EntitiesClient } from './entities.client';

/** The shape the editor round-trips through the client. */
const emptyHexmapBody: EntityBody = {
  type: 'hexmap',
  content: emptyContent(),
  hexes: {},
  regions: [],
  labels: [],
};

describe('EntitiesClient', () => {
  let client: EntitiesClient;
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
    client = TestBed.inject(EntitiesClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

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
    client.list().subscribe((entities) => (listed = entities));

    const req = http.expectOne('/entities');
    expect(req.request.method).toBe('GET');
    req.flush(summaries);

    expect(listed).toEqual(summaries);
  });

  it('creates an entity by name and type', () => {
    let created: EntityDetail | undefined;
    client.create('Aldermoor', 'hexmap').subscribe((e) => (created = e));

    const req = http.expectOne('/entities');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'Aldermoor', type: 'hexmap' });
    req.flush(aldermoor);

    expect(created).toEqual(aldermoor);
  });

  it('loads an entity by id', () => {
    let loaded: EntityDetail | undefined;
    client.load('e1').subscribe((e) => (loaded = e));

    const req = http.expectOne('/entities/e1');
    expect(req.request.method).toBe('GET');
    req.flush(aldermoor);

    expect(loaded).toEqual(aldermoor);
  });

  it('renames an entity (metadata only)', () => {
    let renamed: EntityDetail | undefined;
    client.rename('e1', 'The Whisperwood').subscribe((e) => (renamed = e));

    const req = http.expectOne('/entities/e1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: 'The Whisperwood' });

    const result: EntityDetail = { ...aldermoor, name: 'The Whisperwood' };
    req.flush(result);

    expect(renamed).toEqual(result);
  });

  it('deletes an entity by id', () => {
    let completed = false;
    client.delete('e1').subscribe({ complete: () => (completed = true) });

    const req = http.expectOne('/entities/e1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);

    expect(completed).toBe(true);
  });

  it('saves the body against its base version and reports the saved outcome', () => {
    const painted: EntityBody = {
      ...emptyHexmapBody,
      hexes: { [coordKey({ q: 0, r: 0 })]: { terrain: 'forest' } },
    };

    let outcome: unknown;
    client.save('e1', painted, 1, ['deity', 'ruined']).subscribe((o) => (outcome = o));

    const req = http.expectOne('/entities/e1');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({
      document: painted,
      version: 1,
      tags: ['deity', 'ruined'],
    });

    const saved: EntityDetail = { ...aldermoor, version: 2, document: painted };
    req.flush(saved);

    expect(outcome).toEqual({ status: 'saved', entity: saved });
  });

  it('reports a 409 as a conflict outcome carrying the server entity', () => {
    const serverCurrent: EntityDetail = { ...aldermoor, version: 5 };

    let outcome: unknown;
    client.save('e1', emptyHexmapBody, 1, []).subscribe((o) => (outcome = o));

    http
      .expectOne('/entities/e1')
      .flush(serverCurrent, { status: 409, statusText: 'Conflict' });

    expect(outcome).toEqual({ status: 'conflict', current: serverCurrent });
  });

  it('errors (does not fake a conflict) when a 409 carries a non-object body', () => {
    // A 409 from a proxy/gateway can arrive as an HTML/text body, not an
    // EntityDetail. It must not be reported as a conflict (which would break the
    // conflict UI reading .name/.version off a string) — surface it as an error.
    let errored = false;
    client.save('e1', emptyHexmapBody, 1, []).subscribe({
      error: () => (errored = true),
    });
    http
      .expectOne('/entities/e1')
      .flush('<html>Conflict</html>', { status: 409, statusText: 'Conflict' });

    expect(errored).toBe(true);
  });
});
