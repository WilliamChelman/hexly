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
import { MockEntitiesClient } from '../testing/entities-client.mock';
import { segment } from '../utils/pretty-id';
import { entityWorldRedirect } from './entity-world-redirect.guard';

const W9 = '99999999-9999-4999-8999-999999999999';
const E1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function summary(over: Partial<EntitySummary>): EntitySummary {
  return {
    id: E1,
    worldId: W9,
    name: 'Aldermoor',
    types: ['core.note'],
    tags: [],
    visibility: 'private',
    version: 1,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe('entityWorldRedirect', () => {
  let entities: MockEntitiesClient;

  beforeEach(() => {
    entities = new MockEntitiesClient();
    TestBed.configureTestingModule({
      providers: [{ provide: EntitiesClient, useValue: entities }],
    });
  });

  function run(entitySeg: string, queryParams = {}) {
    return TestBed.runInInjectionContext(() =>
      entityWorldRedirect(
        {
          paramMap: convertToParamMap({ id: entitySeg }),
          queryParams,
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

  it('redirects a legacy bare-UUID link to the World-scoped route with a healed Entity slug', async () => {
    entities.list.mockReturnValue(of({ items: [summary({})], nextCursor: null }));

    const value = await settle(run(E1, { view: 'note' }));
    expect(entities.list).toHaveBeenCalledWith({ ids: [E1] });
    expect(value).toBeInstanceOf(UrlTree);
    // Bare World segment — the parent activeWorldGuard heals its slug on landing.
    expect((value as UrlTree).toString()).toBe(
      `/w/${segment(W9)}/entities/${segment(E1, 'Aldermoor')}?view=note`,
    );
  });

  it('decodes a base62 segment before looking the Entity up', async () => {
    entities.list.mockReturnValue(of({ items: [summary({})], nextCursor: null }));

    await settle(run(segment(E1)));
    expect(entities.list).toHaveBeenCalledWith({ ids: [E1] });
  });

  it('falls through to render the error page when the target is missing', async () => {
    entities.list.mockReturnValue(of({ items: [], nextCursor: null }));

    expect(await settle(run(segment(E1)))).toBe(true);
  });

  it('falls through to render the error page when the lookup errors', async () => {
    entities.list.mockReturnValue(throwError(() => new Error('boom')));

    expect(await settle(run(segment(E1)))).toBe(true);
  });
});
