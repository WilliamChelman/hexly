import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, convertToParamMap, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { firstValueFrom, isObservable, Observable, of, Subject, throwError } from 'rxjs';
import { WorldDetail } from '@hexly/domain';
import { TranslocoService } from '@jsverse/transloco';
import { WorldsClient } from './worlds.client';
import { NudgeBusClient } from './nudge-bus.client';
import { MockNudgeBusClient } from '../testing/nudge-bus.mock';
import { ToasterService } from './toaster.service';
import { MockWorldsClient } from '../testing/worlds-client.mock';
import { EVICTED, Watched } from './live-follow';
import { segment } from '../utils/pretty-id';
import { ActiveWorld, activeWorldGuard, clearActiveWorld } from './active-world';

const WORLD_ID = '11111111-1111-4111-8111-111111111111';
const detail = { id: WORLD_ID, name: 'Aldermoor', updatedAt: 1 } as WorldDetail;

function settle(result: unknown): Promise<boolean | UrlTree> {
  return isObservable(result)
    ? firstValueFrom(result as Observable<boolean | UrlTree>)
    : Promise.resolve(result as boolean | UrlTree);
}

describe('ActiveWorld', () => {
  let active: ActiveWorld;
  let worlds: MockWorldsClient;
  let bus: MockNudgeBusClient;
  let watched: Subject<Watched<WorldDetail>>;
  let navigate: ReturnType<typeof vi.spyOn>;
  let toaster: { show: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    worlds = new MockWorldsClient();
    bus = new MockNudgeBusClient();
    // The store's live-follow is tested in its own spec; here ActiveWorld reacts to what
    // WorldsClient.watch emits, so stub it with a Subject the test pushes into.
    watched = new Subject<Watched<WorldDetail>>();
    worlds.watch.mockReturnValue(watched);
    toaster = { show: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: WorldsClient, useValue: worlds },
        { provide: NudgeBusClient, useValue: bus },
        { provide: ToasterService, useValue: toaster },
        {
          provide: TranslocoService,
          useValue: { translate: (k: string) => k },
        },
      ],
    });
    active = TestBed.inject(ActiveWorld);
    // Spy on the real Router (the guard relies on parseUrl) rather than replacing it.
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  function run(worldSeg: string, url = `/w/${worldSeg}`) {
    return TestBed.runInInjectionContext(() =>
      activeWorldGuard(
        {
          paramMap: convertToParamMap({ worldId: worldSeg }),
        } as ActivatedRouteSnapshot,
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

    expect((value as UrlTree).toString()).toBe(`/w/${segment(WORLD_ID, 'Aldermoor')}/entities?q=orc`);
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

    expect(toaster.show).toHaveBeenCalledWith('core.pinError', 'error');
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
      clearActiveWorld(null, {} as ActivatedRouteSnapshot, {} as RouterStateSnapshot, next),
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

  // Live-follow (ADR-0044, #176/#178): ActiveWorld reacts to what WorldsClient.watch emits — a fresh
  // detail (re-pin if at least as fresh as held) or EVICTED (blank + return to the Index). The
  // follow / debounced refetch / freshness dedup all live in FollowStore + watchResource (their specs).
  describe('live-follow', () => {
    /** Pin a World (held updatedAt = 1) and settle the reconciler's subscription to worlds.watch. */
    function follow() {
      active.set(detail, WORLD_ID);
      TestBed.flushEffects();
    }

    it('evicts the active World to the Index on EVICTED (membership loss / delete / gone across a gap)', () => {
      follow();
      watched.next(EVICTED);

      expect(active.worldId()).toBeNull();
      expect(active.world()).toBeNull();
      expect(navigate).toHaveBeenCalledWith(['/']);
    });

    it('re-pins the World on a fresh detail (rename / pin reorder) without navigating away', () => {
      follow();
      const renamed = {
        id: WORLD_ID,
        name: 'Aldermoor Reborn',
        updatedAt: 2,
      } as WorldDetail;

      watched.next(renamed);

      expect(active.world()).toBe(renamed);
      expect(active.name()).toBe('Aldermoor Reborn');
      expect(navigate).not.toHaveBeenCalled();
    });

    // The store's refetch and this tab's own commitPins are independent, with no response ordering:
    // a stale read resolving late must not revert a newer local write back to old pins.
    it('drops a detail staler than a newer local write (apply-guard)', () => {
      follow();
      const local = {
        id: WORLD_ID,
        name: 'Local Reorder',
        updatedAt: 5,
      } as WorldDetail;
      active.set(local, WORLD_ID); // this tab's own commitPins advanced the held detail

      watched.next({
        id: WORLD_ID,
        name: 'Stale',
        updatedAt: 2,
      } as WorldDetail);

      expect(active.world()).toBe(local); // not clobbered back to the stale read
    });
  });
});
