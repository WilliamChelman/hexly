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
    expect(req.request.params.keys()).toEqual([]);
    req.flush(page);

    expect(listed).toEqual(page);
  });

  it('serializes ids/q/type/cursor/limit into the query string', () => {
    client
      .list({ ids: ['a', 'b'], q: 'river', type: ['note'], cursor: 'CUR', limit: 25 })
      .subscribe();

    const req = http.expectOne((r) => r.url === '/api/entities');
    expect(req.request.params.getAll('ids')).toEqual(['a', 'b']);
    expect(req.request.params.get('q')).toBe('river');
    expect(req.request.params.getAll('type')).toEqual(['note']);
    expect(req.request.params.get('cursor')).toBe('CUR');
    expect(req.request.params.get('limit')).toBe('25');
    req.flush({ items: [], nextCursor: null });
  });

  it('serializes multi-valued Facet params as repeats (OR within category, #155)', () => {
    client
      .list({ type: ['note', 'hexmap'], tag: ['deity', 'ruined'], visibility: ['shared'] })
      .subscribe();

    const req = http.expectOne((r) => r.url === '/api/entities');
    expect(req.request.params.getAll('type')).toEqual(['note', 'hexmap']);
    expect(req.request.params.getAll('tag')).toEqual(['deity', 'ruined']);
    expect(req.request.params.getAll('visibility')).toEqual(['shared']);
    req.flush({ items: [], nextCursor: null });
  });

  it('fetches Facet counts from /api/entities/facets under the active filters (#155)', () => {
    const facets = {
      type: [{ value: 'note', count: 3 }],
      tag: [{ value: 'deity', count: 2 }],
      visibility: [{ value: 'private', count: 3 }],
    };

    let got: unknown;
    client
      .facets({ q: 'temple', tag: ['deity'], worldId: 'w1' })
      .subscribe((f) => (got = f));

    const req = http.expectOne((r) => r.url === '/api/entities/facets');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('q')).toBe('temple');
    expect(req.request.params.getAll('tag')).toEqual(['deity']);
    expect(req.request.params.get('worldId')).toBe('w1');
    req.flush(facets);

    expect(got).toEqual(facets);
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

  it('scopes a create to a World when worldId is given', () => {
    client.create('Aldermoor', 'hexmap', 'w9').subscribe();

    const req = http.expectOne('/api/entities');
    expect(req.request.body).toEqual({
      name: 'Aldermoor',
      type: 'hexmap',
      worldId: 'w9',
    });
    req.flush(aldermoor);
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
      .save('e1', painted, 1, ['deity', 'ruined'])
      .subscribe((o) => (outcome = o));

    const req = http.expectOne('/api/entities/e1');
    expect(req.request.method).toBe('PUT');
    // Descriptors are no longer sent — the server harvests them from the document (#96).
    expect(req.request.body).toEqual({
      document: painted,
      version: 1,
      tags: ['deity', 'ruined'],
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
    client.save('e1', emptyHexmapBody, 1, []).subscribe((o) => (outcome = o));

    http
      .expectOne('/api/entities/e1')
      .flush(serverCurrent, { status: 409, statusText: 'Conflict' });

    expect(outcome).toEqual({ status: 'conflict', current: serverCurrent });
  });

  it('errors (does not fake a conflict) when a 409 carries a non-object body', () => {
    // 409 from a proxy/gateway can be HTML/text, not EntityDetail. Must not
    // be reported as a conflict to avoid breaking the conflict UI.
    let errored = false;
    client.save('e1', emptyHexmapBody, 1, []).subscribe({
      error: () => (errored = true),
    });
    http
      .expectOne('/api/entities/e1')
      .flush('<html>Conflict</html>', { status: 409, statusText: 'Conflict' });

    expect(errored).toBe(true);
  });
});
