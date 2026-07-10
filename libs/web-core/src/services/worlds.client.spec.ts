import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ImportSummary, WorldDetail, WorldGraph, WorldSummary } from '@hexly/domain';
import { WorldsClient, WORLD_NUDGE_DEBOUNCE_MS } from './worlds.client';
import { NudgeBusClient } from './nudge-bus.client';
import { MockNudgeBusClient } from '../testing/nudge-bus.mock';
import { EVICTED } from './live-follow';

describe('WorldsClient', () => {
  let client: WorldsClient;
  let http: HttpTestingController;
  let bus: MockNudgeBusClient;

  const summary: WorldSummary = {
    id: 'w1',
    name: 'Aldermoor',
    owners: ['u1'],
    rights: ['read', 'manage'],
    createdAt: 1,
    updatedAt: 1,
  };
  const detail: WorldDetail = { ...summary, entityCount: 1, pinnedEntityIds: [], seq: 1 };
  const graph: WorldGraph = {
    nodes: [
      { id: 'e1', name: 'Ealdred', type: 'note' },
      { id: 'e2', name: 'Mira', type: 'note' },
    ],
    edges: [{ source: 'e1', target: 'e2', descriptor: 'spouse' }],
  };

  beforeEach(() => {
    bus = new MockNudgeBusClient();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NudgeBusClient, useValue: bus },
      ],
    });
    client = TestBed.inject(WorldsClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists the caller’s worlds as summaries', () => {
    let listed: unknown;
    client.list().subscribe((w) => (listed = w));

    const req = http.expectOne('/api/worlds');
    expect(req.request.method).toBe('GET');
    req.flush([summary]);

    expect(listed).toEqual([summary]);
  });

  it('creates a world by name', () => {
    let created: WorldDetail | undefined;
    client.create('Aldermoor').subscribe((w) => (created = w));

    const req = http.expectOne('/api/worlds');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ name: 'Aldermoor' });
    req.flush(detail);

    expect(created).toEqual(detail);
  });

  it('gets one world as a detail', () => {
    let got: WorldDetail | undefined;
    client.get('w1').subscribe((w) => (got = w));

    const req = http.expectOne('/api/worlds/w1');
    expect(req.request.method).toBe('GET');
    req.flush(detail);

    expect(got).toEqual(detail);
  });

  it('fetches the World Graph as one full-World payload', () => {
    let got: WorldGraph | undefined;
    client.graph('w1').subscribe((g) => (got = g));

    const req = http.expectOne('/api/worlds/w1/graph');
    expect(req.request.method).toBe('GET');
    req.flush(graph);

    expect(got).toEqual(graph);
  });

  it('renames a world', () => {
    let renamed: WorldDetail | undefined;
    client.rename('w1', 'The Reach').subscribe((w) => (renamed = w));

    const req = http.expectOne('/api/worlds/w1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: 'The Reach' });
    req.flush({ ...detail, name: 'The Reach' });

    expect(renamed?.name).toBe('The Reach');
  });

  it('sets the World pins via a wholesale PATCH', () => {
    let updated: WorldDetail | undefined;
    client.setPins('w1', ['p2', 'p1']).subscribe((w) => (updated = w));

    const req = http.expectOne('/api/worlds/w1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ pinnedEntityIds: ['p2', 'p1'] });
    req.flush({ ...detail, pinnedEntityIds: ['p2', 'p1'] });

    expect(updated?.pinnedEntityIds).toEqual(['p2', 'p1']);
  });

  it('imports a vault zip as multipart and returns the summary', () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'Aldermoor.zip', {
      type: 'application/zip',
    });
    const importSummary: ImportSummary = {
      worldId: 'w9',
      notesImported: 3,
      filesSkipped: 0,
      linksResolved: 1,
      linksDangling: 0,
      assetsStored: 0,
      constructsDegraded: {},
    };
    let got: ImportSummary | undefined;
    client.importVault(file).subscribe((s) => (got = s));

    const req = http.expectOne('/api/worlds/import');
    expect(req.request.method).toBe('POST');
    // Multipart: the browser sets the Content-Type boundary, so we must not.
    expect(req.request.headers.has('Content-Type')).toBe(false);
    const body = req.request.body as FormData;
    expect(body.get('file')).toBe(file);
    req.flush(importSummary);

    expect(got).toEqual(importSummary);
  });

  it('exports a world as a binary zip blob', () => {
    let got: Blob | undefined;
    client.exportVault('w1').subscribe((b) => (got = b));

    const req = http.expectOne('/api/worlds/w1/export');
    expect(req.request.method).toBe('GET');
    expect(req.request.responseType).toBe('blob');
    const zip = new Blob([new Uint8Array([1, 2, 3])], { type: 'application/zip' });
    req.flush(zip);

    expect(got).toBe(zip);
  });

  it('deletes a world by id', () => {
    let completed = false;
    client.delete('w1').subscribe({ complete: () => (completed = true) });

    const req = http.expectOne('/api/worlds/w1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);

    expect(completed).toBe(true);
  });

  // watch() fronts the live-follow bus for one World (ADR-0044): a nudge → debounced get() refetch,
  // an unavailable eviction → EVICTED. The reconcile logic lives in watchResource (tested via its
  // consumers); this locks that watch() wires the right ref, fetch, and debounce.
  describe('watch (live-follow)', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('follows the World ref and refetches its detail on a readable nudge', () => {
      const seen: unknown[] = [];
      const sub = client.watch('w1').subscribe((r) => seen.push(r));
      expect(bus.follow).toHaveBeenCalledWith({ kind: 'world', id: 'w1' });

      bus.emit({ id: 'w1', seq: 2 });
      vi.advanceTimersByTime(WORLD_NUDGE_DEBOUNCE_MS);
      http.expectOne('/api/worlds/w1').flush(detail);

      expect(seen).toEqual([detail]);
      sub.unsubscribe();
    });

    it('emits EVICTED on an unavailable nudge without refetching', () => {
      const seen: unknown[] = [];
      const sub = client.watch('w1').subscribe((r) => seen.push(r));

      bus.emit({ id: 'w1', unavailable: true });

      expect(seen).toEqual([EVICTED]);
      sub.unsubscribe();
    });
  });
});
