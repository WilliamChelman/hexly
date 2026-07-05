import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ImportSummary, WorldDetail, WorldSummary } from '@hexly/domain';
import { WorldsClient } from './worlds.client';

describe('WorldsClient', () => {
  let client: WorldsClient;
  let http: HttpTestingController;

  const summary: WorldSummary = {
    id: 'w1',
    name: 'Aldermoor',
    owners: ['u1'],
    rights: ['read', 'manage'],
    createdAt: 1,
    updatedAt: 1,
  };
  const detail: WorldDetail = { ...summary, homeEntityId: 'e1', entityCount: 1 };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
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

  it('renames a world', () => {
    let renamed: WorldDetail | undefined;
    client.rename('w1', 'The Reach').subscribe((w) => (renamed = w));

    const req = http.expectOne('/api/worlds/w1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ name: 'The Reach' });
    req.flush({ ...detail, name: 'The Reach' });

    expect(renamed?.name).toBe('The Reach');
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
});
