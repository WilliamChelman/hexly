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
    worldId: 'w1',
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

  const summary: EntitySummary = {
    id: 'e1',
    ownerId: 'u1',
    worldId: 'w1',
    name: 'Aldermoor',
    type: 'hexmap',
    tags: [],
    visibility: 'private',
    version: 1,
    createdAt: 1,
    updatedAt: 1,
  };

  it('lists entities as the page envelope (items + nextCursor)', () => {
    const page = { items: [summary], nextCursor: 'CURSOR-2' };

    let listed: unknown;
    client.list().subscribe((p) => (listed = p));

    const req = http.expectOne('/api/entities');
    expect(req.request.method).toBe('GET');
    // No options → no query params.
    expect(req.request.params.keys()).toEqual([]);
    req.flush(page);

    expect(listed).toEqual(page);
  });

  it('serializes ids/q/type/cursor/limit into the query string', () => {
    client
      .list({ ids: ['a', 'b'], q: 'river', type: 'note', cursor: 'CUR', limit: 25 })
      .subscribe();

    const req = http.expectOne((r) => r.url === '/api/entities');
    expect(req.request.params.getAll('ids')).toEqual(['a', 'b']);
    expect(req.request.params.get('q')).toBe('river');
    expect(req.request.params.get('type')).toBe('note');
    expect(req.request.params.get('cursor')).toBe('CUR');
    expect(req.request.params.get('limit')).toBe('25');
    req.flush({ items: [], nextCursor: null });
  });

  it('creates an entity by name and type', () => {
    let created: EntityDetail | undefined;
    client.create('Aldermoor', 'hexmap').subscribe((e) => (created = e));

    const req = http.expectOne('/api/entities');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'Aldermoor', type: 'hexmap' });
    req.flush(aldermoor);

    expect(created).toEqual(aldermoor);
  });

  it('loads an entity by id', () => {
    let loaded: EntityDetail | undefined;
    client.load('e1').subscribe((e) => (loaded = e));

    const req = http.expectOne('/api/entities/e1');
    expect(req.request.method).toBe('GET');
    req.flush(aldermoor);

    expect(loaded).toEqual(aldermoor);
  });

  it('renames an entity (metadata only)', () => {
    let renamed: EntityDetail | undefined;
    client.rename('e1', 'The Whisperwood').subscribe((e) => (renamed = e));

    const req = http.expectOne('/api/entities/e1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: 'The Whisperwood' });

    const result: EntityDetail = { ...aldermoor, name: 'The Whisperwood' };
    req.flush(result);

    expect(renamed).toEqual(result);
  });

  it('deletes an entity by id', () => {
    let completed = false;
    client.delete('e1').subscribe({ complete: () => (completed = true) });

    const req = http.expectOne('/api/entities/e1');
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
    client
      .save('e1', painted, 1, ['deity', 'ruined'], ['spouse'])
      .subscribe((o) => (outcome = o));

    const req = http.expectOne('/api/entities/e1');
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({
      document: painted,
      version: 1,
      tags: ['deity', 'ruined'],
      descriptors: ['spouse'],
    });

    const saved: EntityDetail = { ...aldermoor, version: 2, document: painted };
    req.flush(saved);

    expect(outcome).toEqual({ status: 'saved', entity: saved });
  });

  it('reads the owner’s descriptor vocabulary (#96)', () => {
    let listed: unknown;
    client.listDescriptors().subscribe((d) => (listed = d));

    const req = http.expectOne('/api/entities/descriptors');
    expect(req.request.method).toBe('GET');
    req.flush(['capital of', 'spouse']);

    expect(listed).toEqual(['capital of', 'spouse']);
  });

  it('reports a 409 as a conflict outcome carrying the server entity', () => {
    const serverCurrent: EntityDetail = { ...aldermoor, version: 5 };

    let outcome: unknown;
    client.save('e1', emptyHexmapBody, 1, [], []).subscribe((o) => (outcome = o));

    http
      .expectOne('/api/entities/e1')
      .flush(serverCurrent, { status: 409, statusText: 'Conflict' });

    expect(outcome).toEqual({ status: 'conflict', current: serverCurrent });
  });

  it('errors (does not fake a conflict) when a 409 carries a non-object body', () => {
    // A 409 from a proxy/gateway can arrive as an HTML/text body, not an
    // EntityDetail. It must not be reported as a conflict (which would break the
    // conflict UI reading .name/.version off a string) — surface it as an error.
    let errored = false;
    client.save('e1', emptyHexmapBody, 1, [], []).subscribe({
      error: () => (errored = true),
    });
    http
      .expectOne('/api/entities/e1')
      .flush('<html>Conflict</html>', { status: 409, statusText: 'Conflict' });

    expect(errored).toBe(true);
  });
});
