import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  convertToParamMap,
  RouterStateSnapshot,
} from '@angular/router';
import {
  ActiveWorld,
  activeWorldResolver,
  clearActiveWorld,
} from './active-world';

/** An ActivatedRouteSnapshot stub carrying just the params the resolver reads. */
function snapshot(params: Record<string, string>): ActivatedRouteSnapshot {
  return { paramMap: convertToParamMap(params) } as ActivatedRouteSnapshot;
}

describe('ActiveWorld', () => {
  let active: ActiveWorld;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    active = TestBed.inject(ActiveWorld);
  });

  it('starts with no active World', () => {
    expect(active.worldId()).toBeNull();
  });

  it('exposes the World id that set() pins', () => {
    active.set('aldermoor');
    expect(active.worldId()).toBe('aldermoor');
  });

  it('the resolver pins the active World from the :worldId route segment', () => {
    const resolved = TestBed.runInInjectionContext(() =>
      activeWorldResolver(snapshot({ worldId: 'aldermoor' }), {} as never),
    );

    expect(resolved).toBe('aldermoor');
    expect(active.worldId()).toBe('aldermoor');
  });

  it('the deactivate guard clears the active World on leaving the World scope', () => {
    active.set('aldermoor');

    const ok = TestBed.runInInjectionContext(() =>
      clearActiveWorld(
        null,
        snapshot({}),
        {} as RouterStateSnapshot,
        {} as RouterStateSnapshot,
      ),
    );

    expect(ok).toBe(true);
    expect(active.worldId()).toBeNull();
  });
});
