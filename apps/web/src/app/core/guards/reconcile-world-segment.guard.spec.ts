import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  convertToParamMap,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { firstValueFrom, isObservable, Observable } from 'rxjs';
import { EntitySummary } from '@hexly/domain';
import { reconcileWorldSegment } from './reconcile-world-segment.guard';

function summary(over: Partial<EntitySummary>): EntitySummary {
  return {
    id: 'e1',
    ownerId: 'u1',
    worldId: 'w1',
    name: 'Aldermoor',
    type: 'note',
    tags: [],
    visibility: 'private',
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe('reconcileWorldSegment', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  /** Invoke the guard the way the router would for `w/:worldId/entities/:id`. */
  function run(worldId: string, id = 'e1') {
    return TestBed.runInInjectionContext(() =>
      reconcileWorldSegment(
        {
          paramMap: convertToParamMap({ id }),
          parent: { paramMap: convertToParamMap({ worldId }) },
        } as unknown as ActivatedRouteSnapshot,
        {} as RouterStateSnapshot,
      ),
    );
  }

  function settle(result: unknown): Promise<boolean | UrlTree> {
    return isObservable(result)
      ? firstValueFrom(result as Observable<boolean | UrlTree>)
      : Promise.resolve(result as boolean | UrlTree);
  }

  it("redirects to the Entity's real World when the segment is stale", async () => {
    const settled = settle(run('w1', 'e1'));

    http
      .expectOne('/api/entities?ids=e1')
      .flush({ items: [summary({ id: 'e1', worldId: 'w9' })], nextCursor: null });

    const value = await settled;
    expect(value).toBeInstanceOf(UrlTree);
    expect((value as UrlTree).toString()).toBe('/w/w9/entities/e1');
  });

  it('passes through without redirecting when the segment matches', async () => {
    const settled = settle(run('w1', 'e1'));

    http
      .expectOne('/api/entities?ids=e1')
      .flush({ items: [summary({ id: 'e1', worldId: 'w1' })], nextCursor: null });

    expect(await settled).toBe(true);
  });

  it('falls through (renders the page) when the target is missing', async () => {
    const settled = settle(run('w1', 'ghost'));

    http
      .expectOne('/api/entities?ids=ghost')
      .flush({ items: [], nextCursor: null });

    expect(await settled).toBe(true);
  });

  it('falls through when the lookup errors', async () => {
    const settled = settle(run('w1', 'boom'));

    http
      .expectOne('/api/entities?ids=boom')
      .flush(null, { status: 500, statusText: 'Server Error' });

    expect(await settled).toBe(true);
  });
});
