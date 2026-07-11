import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, convertToParamMap, RouterStateSnapshot, UrlTree } from '@angular/router';
import { firstValueFrom, isObservable, Observable, of, throwError } from 'rxjs';
import { EntitySummary } from '@hexly/domain';
import { EntitiesClient } from '../services/entities.client';
import { MockEntitiesClient } from '../testing/entities-client.mock';
import { segment } from '../utils/pretty-id';
import { reconcileWorldSegment } from './reconcile-world-segment.guard';

const W1 = '11111111-1111-4111-8111-111111111111';
const W9 = '99999999-9999-4999-8999-999999999999';
const E1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function summary(over: Partial<EntitySummary>): EntitySummary {
  return {
    id: E1,
    worldId: W1,
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

describe('reconcileWorldSegment', () => {
  let entities: MockEntitiesClient;

  beforeEach(() => {
    entities = new MockEntitiesClient();
    TestBed.configureTestingModule({
      providers: [{ provide: EntitiesClient, useValue: entities }],
    });
  });

  function run(worldSeg: string, entitySeg: string, queryParams = {}) {
    return TestBed.runInInjectionContext(() =>
      reconcileWorldSegment(
        {
          paramMap: convertToParamMap({ id: entitySeg }),
          queryParams,
          parent: { paramMap: convertToParamMap({ worldId: worldSeg }) },
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

  it("redirects to the Entity's real World (bare — the parent heals its slug)", async () => {
    entities.list.mockReturnValue(of({ items: [summary({ worldId: W9 })], nextCursor: null }));

    const value = await settle(run(segment(W1, 'Avalon'), segment(E1, 'Aldermoor')));
    expect((value as UrlTree).toString()).toBe(`/w/${segment(W9)}/entities/${segment(E1, 'Aldermoor')}`);
  });

  it('passes through when the Entity slug is already canonical', async () => {
    entities.list.mockReturnValue(of({ items: [summary({})], nextCursor: null }));

    expect(await settle(run(segment(W1, 'Avalon'), segment(E1, 'Aldermoor')))).toBe(true);
  });

  it('canonicalises a bare Entity slug, preserves the World segment and query', async () => {
    entities.list.mockReturnValue(of({ items: [summary({})], nextCursor: null }));

    const value = await settle(run(segment(W1, 'Avalon'), segment(E1), { view: 'note' }));
    expect(entities.list).toHaveBeenCalledWith({ ids: [E1] });
    expect((value as UrlTree).toString()).toBe(
      `/w/${segment(W1, 'Avalon')}/entities/${segment(E1, 'Aldermoor')}?view=note`,
    );
  });

  it('resolves a legacy bare-UUID Entity URL and heals its slug', async () => {
    entities.list.mockReturnValue(of({ items: [summary({})], nextCursor: null }));

    const value = await settle(run(W1, E1));
    expect(entities.list).toHaveBeenCalledWith({ ids: [E1] });
    expect((value as UrlTree).toString()).toBe(`/w/${W1}/entities/${segment(E1, 'Aldermoor')}`);
  });

  it('falls through (renders the page) when the target is missing', async () => {
    entities.list.mockReturnValue(of({ items: [], nextCursor: null }));

    expect(await settle(run(segment(W1), segment(E1)))).toBe(true);
  });

  it('falls through when the lookup errors', async () => {
    entities.list.mockReturnValue(throwError(() => new Error('boom')));

    expect(await settle(run(segment(W1), segment(E1)))).toBe(true);
  });
});
