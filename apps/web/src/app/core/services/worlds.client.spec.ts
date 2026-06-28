import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { WorldDetail, WorldSummary } from '@hexly/domain';
import { WorldsClient } from './worlds.client';

describe('WorldsClient', () => {
  let client: WorldsClient;
  let http: HttpTestingController;

  const summary: WorldSummary = {
    id: 'w1',
    name: 'Aldermoor',
    ownerId: 'u1',
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

  it('deletes a world by id', () => {
    let completed = false;
    client.delete('w1').subscribe({ complete: () => (completed = true) });

    const req = http.expectOne('/api/worlds/w1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);

    expect(completed).toBe(true);
  });
});
