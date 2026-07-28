import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { WorldDetail, WorldVerb } from '@hexly/domain';
import { ActiveWorld, worldDashboardRoute, worldGraphRoute } from '@hexly/web-core';
import { provideTranslocoTesting } from '../../../testing/transloco-testing';
import { NavRailStore } from '../../shell/nav-rail.store';
import { WorldPage } from './world.page';

function world(rights: WorldVerb[]): WorldDetail {
  return {
    id: 'w1',
    name: 'Aldermoor',
    owners: ['u1'],
    rights,
    entityCount: 0,
    pinnedEntityIds: [],
    seq: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('WorldLayout', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorldPage, provideTranslocoTesting()],
      providers: [provideRouter([])],
    }).compileComponents();
  });

  /** Pin the World, mount the layout (running its effect), return the filled rail slot. */
  function railFor(detail: WorldDetail) {
    TestBed.inject(ActiveWorld).set(detail);
    TestBed.createComponent(WorldPage).detectChanges();
    return TestBed.inject(NavRailStore).entries();
  }

  it('fills the rail with the Dashboard, Entities, Assets and Graph links from the active World (ADR-0041)', () => {
    expect(railFor(world(['read'])).map((e) => e.testid)).toEqual([
      'nav-dashboard',
      'nav-entities',
      'nav-assets',
      'nav-world-graph',
    ]);
  });

  /** The World Graph is a read of the World, so it shows to anyone who can reach it (#181). */
  it('links the World Graph with the canonical slug-base62 route (ADR-0042)', () => {
    const graph = railFor(world(['read']))[3];
    expect(graph.link).toEqual(worldGraphRoute('w1', 'Aldermoor'));
  });

  it('matches the Dashboard link exactly, so it does not stay lit across the World scope', () => {
    const dashboard = railFor(world(['read']))[0];
    expect(dashboard.link).toEqual(worldDashboardRoute('w1', 'Aldermoor'));
    expect(dashboard.exact).toBe(true);
  });

  it('adds World Settings only when the caller may manage the World (ADR-0039)', () => {
    expect(railFor(world(['read', 'manage'])).map((e) => e.testid)).toEqual([
      'nav-dashboard',
      'nav-entities',
      'nav-assets',
      'nav-world-graph',
      'nav-world-settings',
    ]);
  });

  it('clears the rail slot when the World scope is left', () => {
    TestBed.inject(ActiveWorld).set(world(['manage']));
    const fixture = TestBed.createComponent(WorldPage);
    fixture.detectChanges();
    expect(TestBed.inject(NavRailStore).entries().length).toBeGreaterThan(0);

    fixture.destroy();
    expect(TestBed.inject(NavRailStore).entries()).toEqual([]);
  });
});
