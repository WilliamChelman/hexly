import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  convertToParamMap,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { firstValueFrom, isObservable, Observable, of, throwError } from 'rxjs';
import { WorldDetail } from '@hexly/domain';
import { TranslocoService } from '@jsverse/transloco';
import { WorldsClient } from './worlds.client';
import { ToasterService } from './toaster.service';
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
  let toaster: { show: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    worlds = new MockWorldsClient();
    toaster = { show: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: WorldsClient, useValue: worlds },
        { provide: ToasterService, useValue: toaster },
        { provide: TranslocoService, useValue: { translate: (k: string) => k } },
      ],
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

  it('commitPins persists the set wholesale and re-pins from the returned Detail', () => {
    active.set(detail, WORLD_ID);
    const updated = { ...detail, pinnedEntityIds: ['a', 'b'] } as WorldDetail;
    worlds.setPins.mockReturnValue(of(updated));

    active.commitPins(['a', 'b']);

    expect(worlds.setPins).toHaveBeenCalledWith(WORLD_ID, ['a', 'b']);
    expect(active.world()).toBe(updated);
  });

  it('commitPins is a no-op with no active World', () => {
    active.commitPins(['a']);
    expect(worlds.setPins).not.toHaveBeenCalled();
  });

  it('commitPins toasts and leaves the pins untouched on a rejected curation', () => {
    active.set(detail, WORLD_ID);
    worlds.setPins.mockReturnValue(throwError(() => new Error('403')));

    active.commitPins(['a']);

    expect(toaster.show).toHaveBeenCalledWith('worldDashboard.pinError', 'error');
    expect(active.world()).toBe(detail);
  });

  // Build a nextState whose deepest route carries the given World segment (or none).
  function nextState(worldSeg?: string): RouterStateSnapshot {
    const root = {
      paramMap: convertToParamMap(worldSeg ? { worldId: worldSeg } : {}),
      firstChild: null,
    } as unknown as ActivatedRouteSnapshot;
    return { root } as RouterStateSnapshot;
  }

  function deactivate(next: RouterStateSnapshot) {
    return TestBed.runInInjectionContext(() =>
      clearActiveWorld(
        null,
        {} as ActivatedRouteSnapshot,
        {} as RouterStateSnapshot,
        next,
      ),
    );
  }

  it('the deactivate guard clears the active World on leaving the World scope', () => {
    active.set(detail, WORLD_ID);

    expect(deactivate(nextState())).toBe(true);
    expect(active.worldId()).toBeNull();
    expect(active.world()).toBeNull();
  });

  it('clears when switching to a different World', () => {
    active.set(detail, WORLD_ID);
    const other = '22222222-2222-4222-8222-222222222222';

    deactivate(nextState(segment(other, 'Bramble')));

    expect(active.worldId()).toBeNull();
  });

  // The slug self-heal re-segments the same World (uuid → slug-base62); the decoded id
  // is unchanged, so the scope must stay pinned or the rail blanks mid-redirect.
  it('keeps the World pinned when the destination is the same World (slug heal)', () => {
    active.set(detail, WORLD_ID);

    deactivate(nextState(WORLD_ID)); // bare-uuid form of the already-active World

    expect(active.worldId()).toBe(WORLD_ID);
    expect(active.world()).toBe(detail);
  });
});
