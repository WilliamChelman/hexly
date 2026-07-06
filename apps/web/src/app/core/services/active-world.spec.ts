import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  convertToParamMap,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { firstValueFrom, isObservable, Observable, of, throwError } from 'rxjs';
import { WorldDetail } from '@hexly/domain';
import { WorldsClient } from './worlds.client';
import { MockWorldsClient } from '../testing/worlds-client.mock';
import { segment } from '../utils/pretty-id';
import { ActiveWorld, activeWorldGuard, clearActiveWorld } from './active-world';

const WORLD_ID = '11111111-1111-4111-8111-111111111111';
const detail = { id: WORLD_ID, name: 'Aldermoor' } as WorldDetail;

function settle(result: unknown): Promise<boolean | UrlTree> {
  return isObservable(result)
    ? firstValueFrom(result as Observable<boolean | UrlTree>)
    : Promise.resolve(result as boolean | UrlTree);
}

describe('ActiveWorld', () => {
  let active: ActiveWorld;
  let worlds: MockWorldsClient;

  beforeEach(() => {
    worlds = new MockWorldsClient();
    TestBed.configureTestingModule({
      providers: [{ provide: WorldsClient, useValue: worlds }],
    });
    active = TestBed.inject(ActiveWorld);
  });

  function run(worldSeg: string, url = `/w/${worldSeg}`) {
    return TestBed.runInInjectionContext(() =>
      activeWorldGuard(
        { paramMap: convertToParamMap({ worldId: worldSeg }) } as ActivatedRouteSnapshot,
        { url } as RouterStateSnapshot,
      ),
    );
  }

  it('starts with no active World', () => {
    expect(active.worldId()).toBeNull();
    expect(active.world()).toBeNull();
  });

  it('fetches and pins the World detail from the :worldId segment', async () => {
    worlds.get.mockReturnValue(of(detail));

    await settle(run(segment(WORLD_ID, 'Aldermoor')));

    expect(worlds.get).toHaveBeenCalledWith(WORLD_ID);
    expect(active.worldId()).toBe(WORLD_ID);
    expect(active.world()).toBe(detail);
    expect(active.name()).toBe('Aldermoor');
  });

  it('heals a bare/legacy World segment to its canonical slug, preserving the query', async () => {
    worlds.get.mockReturnValue(of(detail));

    const value = await settle(run(WORLD_ID, `/w/${WORLD_ID}/entities?q=orc`));

    expect((value as UrlTree).toString()).toBe(
      `/w/${segment(WORLD_ID, 'Aldermoor')}/entities?q=orc`,
    );
  });

  it('passes through when the segment is already canonical', async () => {
    worlds.get.mockReturnValue(of(detail));

    expect(await settle(run(segment(WORLD_ID, 'Aldermoor')))).toBe(true);
  });

  it('reuses an already-pinned World without re-fetching', async () => {
    active.set(detail, WORLD_ID);

    expect(await settle(run(segment(WORLD_ID, 'Aldermoor')))).toBe(true);
    expect(worlds.get).not.toHaveBeenCalled();
  });

  it('pins the id alone and proceeds when the fetch fails', async () => {
    worlds.get.mockReturnValue(throwError(() => new Error('boom')));

    expect(await settle(run(segment(WORLD_ID)))).toBe(true);
    expect(active.worldId()).toBe(WORLD_ID);
    expect(active.world()).toBeNull();
  });

  it('the deactivate guard clears the active World on leaving the World scope', () => {
    active.set(detail, WORLD_ID);

    const ok = TestBed.runInInjectionContext(() =>
      clearActiveWorld(
        null,
        {} as ActivatedRouteSnapshot,
        {} as RouterStateSnapshot,
        {} as RouterStateSnapshot,
      ),
    );

    expect(ok).toBe(true);
    expect(active.worldId()).toBeNull();
    expect(active.world()).toBeNull();
  });
});
