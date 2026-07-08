import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  convertToParamMap,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, isObservable, Observable, of, Subject, throwError } from 'rxjs';
import { WorldDetail } from '@hexly/domain';
import { TranslocoService } from '@jsverse/transloco';
import { WorldsClient } from './worlds.client';
import { NudgeBusClient } from './nudge-bus.client';
import { MockNudgeBusClient } from '../testing/nudge-bus.mock';
import { ToasterService } from './toaster.service';
import { MockWorldsClient } from '../testing/worlds-client.mock';
import { segment } from '../utils/pretty-id';
import { ActiveWorld, activeWorldGuard, clearActiveWorld } from './active-world';
import { WORLD_NUDGE_DEBOUNCE_MS } from './world.store';

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
  let navigate: ReturnType<typeof vi.spyOn>;
  let toaster: { show: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    worlds = new MockWorldsClient();
    bus = new MockNudgeBusClient();
    toaster = { show: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: WorldsClient, useValue: worlds },
        { provide: NudgeBusClient, useValue: bus },
        { provide: ToasterService, useValue: toaster },
        { provide: TranslocoService, useValue: { translate: (k: string) => k } },
      ],
    });
    active = TestBed.inject(ActiveWorld);
    // Spy on the real Router (the guard relies on parseUrl) rather than replacing it.
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
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

  // Live-follow eviction (ADR-0044, #176): losing access to the open World blanks it and sends the
  // viewer to the World Index, rather than leaving an open Dashboard for a World they can't enter.
  describe('live eviction', () => {
    it('evicts the active World to the Index when it becomes unavailable (membership loss / delete)', () => {
      active.set(detail, WORLD_ID);
      TestBed.flushEffects(); // settle the follow subscription

      bus.emit({ id: WORLD_ID, unavailable: true });

      expect(active.worldId()).toBeNull();
      expect(active.world()).toBeNull();
      expect(navigate).toHaveBeenCalledWith(['/']);
    });

    it('does not navigate away on a readable World nudge — a rename/pin change is live-follow, not eviction', () => {
      active.set(detail, WORLD_ID);
      TestBed.flushEffects();

      bus.emit({ id: WORLD_ID, updatedAt: 2 });

      expect(active.worldId()).toBe(WORLD_ID);
      expect(navigate).not.toHaveBeenCalled();
    });
  });

  // Open-Dashboard live-follow (ADR-0044, #178): a readable World nudge (rename / pin reorder /
  // metadata) refetches the authoritative detail and re-pins it, so an open Dashboard — which
  // derives its name and pins from active.world() — reflects the change without a reload.
  describe('live-follow refetch', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('refetches and re-pins the World detail once after the debounce on a readable nudge', () => {
      active.set(detail, WORLD_ID);
      TestBed.flushEffects(); // settle the follow subscription
      const renamed = { id: WORLD_ID, name: 'Aldermoor Reborn', updatedAt: 2 } as WorldDetail;
      worlds.get.mockReturnValue(of(renamed));

      bus.emit({ id: WORLD_ID, updatedAt: 2 });
      expect(worlds.get).not.toHaveBeenCalled(); // debounced, not yet

      vi.advanceTimersByTime(WORLD_NUDGE_DEBOUNCE_MS);

      expect(worlds.get).toHaveBeenCalledWith(WORLD_ID);
      expect(active.world()).toBe(renamed);
      expect(active.name()).toBe('Aldermoor Reborn');
    });

    it('refetches and re-pins on a stale reconnect pulse, though it carries no newer updatedAt (#177)', () => {
      active.set(detail, WORLD_ID); // held updatedAt = 1
      TestBed.flushEffects();
      // While disconnected the World was renamed; the reconnect pulse can't know its updatedAt, so
      // it must refetch unconditionally to reconcile the gap (no server replay).
      const renamed = { id: WORLD_ID, name: 'Aldermoor Reborn', updatedAt: 2 } as WorldDetail;
      worlds.get.mockReturnValue(of(renamed));

      bus.emit({ id: WORLD_ID, stale: true });
      vi.advanceTimersByTime(WORLD_NUDGE_DEBOUNCE_MS);

      expect(worlds.get).toHaveBeenCalledWith(WORLD_ID);
      expect(active.world()).toBe(renamed);
    });

    it('evicts the active World to the Index when the reconnect refetch finds it gone (#177)', () => {
      active.set(detail, WORLD_ID);
      TestBed.flushEffects();
      // Access ended while disconnected (removed as member / World deleted): no eviction nudge to
      // replay, so the refetch's 404 is what surfaces the loss.
      worlds.get.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 404 })));

      bus.emit({ id: WORLD_ID, stale: true });
      vi.advanceTimersByTime(WORLD_NUDGE_DEBOUNCE_MS);

      expect(active.worldId()).toBeNull();
      expect(navigate).toHaveBeenCalledWith(['/']);
    });

    it('ignores a self-echo nudge no newer than the held detail — no redundant refetch', () => {
      active.set(detail, WORLD_ID); // held updatedAt = 1
      TestBed.flushEffects();

      bus.emit({ id: WORLD_ID, updatedAt: 1 });
      vi.advanceTimersByTime(WORLD_NUDGE_DEBOUNCE_MS);

      expect(worlds.get).not.toHaveBeenCalled();
    });

    // The nudge-driven GET and this tab's own commitPins are independent subscriptions with no
    // response ordering. A GET issued while the held detail was old must not, on resolving late,
    // revert a newer local write (e.g. a pin reorder committed in the meantime) back to stale state.
    it('drops a stale in-flight refetch that resolves after a newer local write', () => {
      active.set(detail, WORLD_ID); // held updatedAt = 1
      TestBed.flushEffects();
      const inflight = new Subject<WorldDetail>();
      worlds.get.mockReturnValue(inflight);

      bus.emit({ id: WORLD_ID, updatedAt: 2 });
      vi.advanceTimersByTime(WORLD_NUDGE_DEBOUNCE_MS); // GET issued (in flight), held still updatedAt 1

      // This tab's own commitPins lands with a newer detail while the GET is still in flight.
      const local = { id: WORLD_ID, name: 'Local Reorder', updatedAt: 5 } as WorldDetail;
      active.set(local, WORLD_ID);
      // The stale GET (read before commitPins committed) now resolves late.
      inflight.next({ id: WORLD_ID, name: 'Stale', updatedAt: 2 } as WorldDetail);

      expect(active.world()).toBe(local); // not clobbered back to the stale read
      expect(active.name()).toBe('Local Reorder');
    });
  });
});
