import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { EntityDetail, PublicWorldView } from '@hexly/domain';
import { PublicClient } from './public.client';
import { WORLD_NUDGE_DEBOUNCE_MS } from './worlds.client';
import { NudgeBusClient } from './nudge-bus.client';
import { MockNudgeBusClient } from '../testing/nudge-bus.mock';
import { EVICTED } from './live-follow';

const TOKEN = 'tok-123';

describe('PublicClient', () => {
  let client: PublicClient;
  let http: HttpTestingController;
  let bus: MockNudgeBusClient;

  const worldView: PublicWorldView = { worldId: 'w1', worldName: 'Aldermoor', entities: [] };
  const entity = { id: 'e1', name: 'Ruin' } as EntityDetail;

  beforeEach(() => {
    vi.useFakeTimers();
    bus = new MockNudgeBusClient();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: NudgeBusClient, useValue: bus },
      ],
    });
    client = TestBed.inject(PublicClient);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  // The public watch() seams own the anonymous token principal for the follow's lifetime, so a
  // signed-in reader who opened their own link doesn't keep connecting as that token after leaving.
  describe('watchWorld', () => {
    it('pins the token principal on subscribe, follows the ref, and refetches via the token read', () => {
      const seen: unknown[] = [];
      const sub = client.watchWorld(TOKEN, 'w1').subscribe((r) => seen.push(r));

      expect(bus.useToken).toHaveBeenCalledWith(TOKEN);
      expect(bus.follow).toHaveBeenCalledWith({ kind: 'world', id: 'w1' });

      bus.emit({ id: 'w1', seq: 2 });
      vi.advanceTimersByTime(WORLD_NUDGE_DEBOUNCE_MS);
      http.expectOne(`/api/public/worlds/${TOKEN}`).flush(worldView);

      expect(seen).toEqual([worldView]);
      sub.unsubscribe();
    });

    it('reverts to the cookie principal on unsubscribe', () => {
      const sub = client.watchWorld(TOKEN, 'w1').subscribe();
      bus.useToken.mockClear();

      sub.unsubscribe();

      expect(bus.useToken).toHaveBeenCalledWith(null);
    });

    it('emits EVICTED on an unavailable nudge (link revoked / World deleted)', () => {
      const seen: unknown[] = [];
      const sub = client.watchWorld(TOKEN, 'w1').subscribe((r) => seen.push(r));

      bus.emit({ id: 'w1', unavailable: true });

      expect(seen).toEqual([EVICTED]);
      sub.unsubscribe();
    });
  });

  describe('watchEntity', () => {
    it('refetches a bare per-entity link via /public/entities/:token', () => {
      const seen: unknown[] = [];
      const sub = client.watchEntity(TOKEN, 'entity', 'e1').subscribe((r) => seen.push(r));

      bus.emit({ id: 'e1', seq: 2 });
      vi.advanceTimersByTime(WORLD_NUDGE_DEBOUNCE_MS);
      http.expectOne(`/api/public/entities/${TOKEN}`).flush(entity);

      expect(seen).toEqual([entity]);
      sub.unsubscribe();
    });

    it('refetches a world-scoped link via /public/worlds/:token/entities/:id', () => {
      const seen: unknown[] = [];
      const sub = client
        .watchEntity(TOKEN, 'worldEntity', 'e1')
        .subscribe((r) => seen.push(r));

      bus.emit({ id: 'e1', seq: 2 });
      vi.advanceTimersByTime(WORLD_NUDGE_DEBOUNCE_MS);
      http.expectOne(`/api/public/worlds/${TOKEN}/entities/e1`).flush(entity);

      expect(seen).toEqual([entity]);
      sub.unsubscribe();
    });
  });
});
