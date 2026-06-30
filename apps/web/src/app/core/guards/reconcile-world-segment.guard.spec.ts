import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  convertToParamMap,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { firstValueFrom, isObservable, Observable, of, throwError } from 'rxjs';
import { EntitySummary } from '@hexly/domain';
import { EntitiesClient } from '../services/entities.client';
import { MockEntitiesClient } from '../testing/mock-entities-client';
import { reconcileWorldSegment } from './reconcile-world-segment.guard';

function summary(over: Partial<EntitySummary> = {}): EntitySummary {
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
  let entities: MockEntitiesClient;

  beforeEach(() => {
    entities = new MockEntitiesClient();
    TestBed.configureTestingModule({
      providers: [{ provide: EntitiesClient, useValue: entities }],
    });
  });

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
    entities.list.mockReturnValue(of({ items: [summary({ worldId: 'w9' })], nextCursor: null }));

    const value = await settle(run('w1', 'e1'));
    expect(entities.list).toHaveBeenCalledWith({ ids: ['e1'] });
    expect(value).toBeInstanceOf(UrlTree);
    expect((value as UrlTree).toString()).toBe('/w/w9/entities/e1');
  });

  it('passes through without redirecting when the segment matches', async () => {
    entities.list.mockReturnValue(of({ items: [summary({ worldId: 'w1' })], nextCursor: null }));

    expect(await settle(run('w1', 'e1'))).toBe(true);
  });

  it('falls through (renders the page) when the target is missing', async () => {
    entities.list.mockReturnValue(of({ items: [], nextCursor: null }));

    expect(await settle(run('w1', 'ghost'))).toBe(true);
  });

  it('falls through when the lookup errors', async () => {
    entities.list.mockReturnValue(throwError(() => new Error('boom')));

    expect(await settle(run('w1', 'boom'))).toBe(true);
  });
});
