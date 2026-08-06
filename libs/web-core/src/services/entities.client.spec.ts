import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { EntityDetail, EntitySummary, EntityDocument } from '@hexly/domain';
import { EntitiesClient, ENTITY_NUDGE_DEBOUNCE_MS } from './entities.client';
import { NudgeBusClient } from './nudge-bus.client';
import { MockNudgeBusClient } from '../testing/nudge-bus.mock';
import { EVICTED } from './live-follow';

/** A blank prose value, inlined: web-core cannot depend on the content plugin (a project cycle). */
const emptyContent = () => ({ format: 'tiptap-v3' as const, snapshot: { type: 'doc', content: [] } });

/** The body IS the EntityDocument map (ADR-0051): a Hex Map's grid and its prose are both Field values in it. */
const emptyHexmapBody: EntityDocument = {
  content: emptyContent(),
  grid: { hexes: {}, regions: [], labels: [] },
};

describe('EntitiesClient', () => {
  let client: EntitiesClient;
  let http: HttpTestingController;
  let bus: MockNudgeBusClient;

  const aldermoor: EntityDetail = {
    id: 'e1',
    worldId: 'w1',
    name: 'Aldermoor',
    types: ['core.type.hex-map'],
    tags: [],
    visibility: 'private',
    version: 1,
    seq: 1,
    createdAt: 1,
    updatedAt: 1,
    document: emptyHexmapBody,
  };

  beforeEach(() => {
    bus = new MockNudgeBusClient();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: NudgeBusClient, useValue: bus }],
    });
    client = TestBed.inject(EntitiesClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  // watch() fronts the write-through store for one Entity (ADR-0044); store internals are covered
  // in entity-store.spec.
  describe('watch (live-follow)', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('follows the Entity ref and refetches on a readable nudge', () => {
      const seen: unknown[] = [];
      const sub = client.watch('e1').subscribe((r) => seen.push(r));
      expect(bus.follow).toHaveBeenCalledWith({ kind: 'entity', id: 'e1' });

      bus.emit({ id: 'e1', seq: 2 });
      vi.advanceTimersByTime(ENTITY_NUDGE_DEBOUNCE_MS);
      http.expectOne('/api/entities/e1').flush(aldermoor);

      expect(seen).toEqual([aldermoor]);
      sub.unsubscribe();
    });

    it('dedups the echo of a write-through save — no refetch, no roundtrip', async () => {
      const seen: unknown[] = [];
      const sub = client.watch('e1').subscribe((r) => seen.push(r));

      // A save writes through the store (advancing held to seq 1).
      client.save('e1', emptyHexmapBody, 0, []).subscribe();
      http.expectOne('/api/entities/e1').flush(aldermoor); // aldermoor is version 1
      await Promise.resolve(); // flush the deferred fanout

      bus.emit({ id: 'e1', seq: 1 }); // the server echoes our own save
      vi.advanceTimersByTime(ENTITY_NUDGE_DEBOUNCE_MS);

      http.expectNone('/api/entities/e1'); // held already at seq 1 → no refetch
      sub.unsubscribe();
    });

    it('emits EVICTED on an unavailable nudge without refetching', () => {
      const seen: unknown[] = [];
      const sub = client.watch('e1').subscribe((r) => seen.push(r));

      bus.emit({ id: 'e1', unavailable: true });

      expect(seen).toEqual([EVICTED]);
      sub.unsubscribe();
    });
  });

  const summary: EntitySummary = {
    id: 'e1',
    worldId: 'w1',
    name: 'Aldermoor',
    types: ['core.type.hex-map'],
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
      .list({
        ids: ['a', 'b'],
        q: 'river',
        type: ['note'],
        cursor: 'CUR',
        limit: 25,
      })
      .subscribe();

    const req = http.expectOne((r) => r.url === '/api/entities');
    expect(req.request.params.getAll('ids')).toEqual(['a', 'b']);
    expect(req.request.params.get('q')).toBe('river');
    expect(req.request.params.getAll('type')).toEqual(['note']);
    expect(req.request.params.get('cursor')).toBe('CUR');
    expect(req.request.params.get('limit')).toBe('25');
    req.flush({ items: [], nextCursor: null });
  });

  it('sizes the page to the id count for an ids read, so none is truncated', () => {
    // No explicit limit: an `ids` read means "resolve exactly these", so the client
    // defaults the limit to the id count rather than the default page size.
    client.list({ ids: ['a', 'b', 'c'] }).subscribe();

    const req = http.expectOne((r) => r.url === '/api/entities');
    expect(req.request.params.get('limit')).toBe('3');
    req.flush({ items: [], nextCursor: null });
  });

  it('lets an explicit limit override the ids-count default', () => {
    client.list({ ids: ['a', 'b', 'c'], limit: 1 }).subscribe();

    const req = http.expectOne((r) => r.url === '/api/entities');
    expect(req.request.params.get('limit')).toBe('1');
    req.flush({ items: [], nextCursor: null });
  });

  it('serializes multi-valued Facet params as repeats (OR within category, #155)', () => {
    client
      .list({
        type: ['note', 'hexmap'],
        tag: ['deity', 'ruined'],
        visibility: ['shared'],
      })
      .subscribe();

    const req = http.expectOne((r) => r.url === '/api/entities');
    expect(req.request.params.getAll('type')).toEqual(['note', 'hexmap']);
    expect(req.request.params.getAll('tag')).toEqual(['deity', 'ruined']);
    expect(req.request.params.getAll('visibility')).toEqual(['shared']);
    req.flush({ items: [], nextCursor: null });
  });

  /**
   * The excluding half of each category (ADR-0081), on both reads: the Facet counts drill down against
   * every other active constraint, and an exclusion is one. A Field's exclusion needs no param — it
   * rides `field`'s own `neq` op.
   */
  it('serializes the exclude* Facet params as repeats, on the list and the Facet read (#422)', () => {
    const excluding = {
      excludeType: ['hexmap' as const],
      excludeTag: ['draft', 'secret'],
      excludeVisibility: ['private' as const],
      excludeContainer: ['c1'],
      field: ['size:neq:large'],
    };

    client.list(excluding).subscribe();
    const listReq = http.expectOne((r) => r.url === '/api/entities');
    expect(listReq.request.params.getAll('excludeType')).toEqual(['hexmap']);
    expect(listReq.request.params.getAll('excludeTag')).toEqual(['draft', 'secret']);
    expect(listReq.request.params.getAll('excludeVisibility')).toEqual(['private']);
    expect(listReq.request.params.getAll('excludeContainer')).toEqual(['c1']);
    expect(listReq.request.params.getAll('field')).toEqual(['size:neq:large']);
    listReq.flush({ items: [], nextCursor: null });

    client.facets(excluding).subscribe();
    const facetReq = http.expectOne((r) => r.url === '/api/entities/facets');
    expect(facetReq.request.params.getAll('excludeTag')).toEqual(['draft', 'secret']);
    facetReq.flush({ type: [], tag: [], visibility: [], fields: [] });

    // A browse that excludes nothing sends none of them.
    client.list({}).subscribe();
    const plain = http.expectOne((r) => r.url === '/api/entities');
    expect(plain.request.params.has('excludeTag')).toBe(false);
    plain.flush({ items: [], nextCursor: null });
  });

  /**
   * The hidden-from-default-listing opt-in (ADR-0065), carried on both reads so a rail's counts and the
   * list they annotate can never disagree about hidden types. A browse omits it and keeps the exclusion.
   */
  it('serializes the includeHidden opt-in on both the list and the Facet read, only when asked', () => {
    client.list({ q: 'sigil', includeHidden: true }).subscribe();
    const listReq = http.expectOne((r) => r.url === '/api/entities');
    expect(listReq.request.params.get('includeHidden')).toBe('1');
    listReq.flush({ items: [], nextCursor: null });

    client.facets({ includeHidden: true }).subscribe();
    const facetReq = http.expectOne((r) => r.url === '/api/entities/facets');
    expect(facetReq.request.params.get('includeHidden')).toBe('1');
    facetReq.flush({ type: [], tag: [], visibility: [], fields: [] });

    client.list({ q: 'sigil' }).subscribe();
    const plain = http.expectOne((r) => r.url === '/api/entities');
    expect(plain.request.params.has('includeHidden')).toBe(false);
    plain.flush({ items: [], nextCursor: null });
  });

  it('fetches Facet counts from /api/entities/facets under the active filters (#155)', () => {
    const facets = {
      type: [{ value: 'note', count: 3 }],
      tag: [{ value: 'deity', count: 2 }],
      visibility: [{ value: 'private', count: 3 }],
    };

    let got: unknown;
    client.facets({ q: 'temple', tag: ['deity'], worldId: 'w1' }).subscribe((f) => (got = f));

    const req = http.expectOne((r) => r.url === '/api/entities/facets');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('q')).toBe('temple');
    expect(req.request.params.getAll('tag')).toEqual(['deity']);
    expect(req.request.params.get('worldId')).toBe('w1');
    req.flush(facets);

    expect(got).toEqual(facets);
  });

  it('creates an entity by name and an ordered type set (#189)', () => {
    let created: EntityDetail | undefined;
    client.create('Aldermoor', ['core.type.hex-map', 'dnd.type.lair']).subscribe((e) => (created = e));

    const req = http.expectOne('/api/entities');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'Aldermoor', types: ['core.type.hex-map', 'dnd.type.lair'] });
    req.flush(aldermoor);

    expect(created).toEqual(aldermoor);
  });

  it('scopes a create to a World and carries initial EntityDocument when given (#189)', () => {
    client.create('Aldermoor', ['core.type.hex-map'], 'w9', { cr: 5 }).subscribe();

    const req = http.expectOne('/api/entities');
    expect(req.request.body).toEqual({
      name: 'Aldermoor',
      types: ['core.type.hex-map'],
      worldId: 'w9',
      document: { cr: 5 },
    });
    req.flush(aldermoor);
  });

  it('mints with a Tag set when given — Inline Creation’s `entities.inlineTag` (ADR-0073)', () => {
    client.create('Zorblax', ['core.type.note'], 'w9', undefined, ['untriaged']).subscribe();

    const req = http.expectOne('/api/entities');
    expect(req.request.body).toEqual({
      name: 'Zorblax',
      types: ['core.type.note'],
      worldId: 'w9',
      tags: ['untriaged'],
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

  it('patches an entity’s name (metadata only)', () => {
    let renamed: EntityDetail | undefined;
    client.patch('e1', { name: 'The Whisperwood' }).subscribe((e) => (renamed = e));

    const req = http.expectOne('/api/entities/e1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: 'The Whisperwood' });

    const result: EntityDetail = { ...aldermoor, name: 'The Whisperwood' };
    req.flush(result);

    expect(renamed).toEqual(result);
  });

  it('patches an entity’s visibility (metadata only, ADR-0037)', () => {
    let updated: EntityDetail | undefined;
    client.patch('e1', { visibility: 'shared' }).subscribe((e) => (updated = e));

    const req = http.expectOne('/api/entities/e1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ visibility: 'shared' });

    const result: EntityDetail = { ...aldermoor, visibility: 'shared' };
    req.flush(result);

    expect(updated).toEqual(result);
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
    const painted: EntityDocument = {
      content: emptyContent(),
      // A plugin's structured value, spelled out: web-core carries no dependency on the map plugin.
      grid: { hexes: { '0,0': { terrain: 'forest' } }, regions: [], labels: [] },
    };

    let outcome: unknown;
    client.save('e1', painted, 1, ['deity', 'ruined']).subscribe((o) => (outcome = o));

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

  it('sends the authored type set only when the save carries one (#189)', () => {
    // A type-set edit (add/remove/reorder) rides the save as an active typed edit...
    client.save('e1', emptyHexmapBody, 1, [], ['core.type.hex-map', 'core.type.note']).subscribe();
    const typed = http.expectOne('/api/entities/e1');
    expect(typed.request.body).toEqual({
      document: emptyHexmapBody,
      version: 1,
      tags: [],
      types: ['core.type.hex-map', 'core.type.note'],
    });
    typed.flush(aldermoor);

    // ...a plain body edit omits `types`, so data at rest is never re-typed.
    client.save('e1', emptyHexmapBody, 2, []).subscribe();
    const plain = http.expectOne('/api/entities/e1');
    expect(plain.request.body).not.toHaveProperty('types');
    plain.flush(aldermoor);
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

    http.expectOne('/api/entities/e1').flush(serverCurrent, { status: 409, statusText: 'Conflict' });

    expect(outcome).toEqual({ status: 'conflict', current: serverCurrent });
  });

  it('errors (does not fake a conflict) when a 409 carries a non-object body', () => {
    // 409 from a proxy/gateway can be HTML/text, not EntityDetail. Must not
    // be reported as a conflict to avoid breaking the conflict UI.
    let errored = false;
    client.save('e1', emptyHexmapBody, 1, []).subscribe({
      error: () => (errored = true),
    });
    http.expectOne('/api/entities/e1').flush('<html>Conflict</html>', { status: 409, statusText: 'Conflict' });

    expect(errored).toBe(true);
  });
});
