import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { WorldDetail, WorldVerb } from '@hexly/domain';
import { ActiveWorld, worldCompendiumRoute, worldDashboardRoute, worldGraphRoute } from '@hexly/web-core';
import { provideTranslocoTesting } from '../../../testing/transloco-testing';
import { NavRailStore } from '../../shell/nav-rail.store';
import { WorldPage } from './world.page';

function world(rights: WorldVerb[]): WorldDetail {
  return {
    id: 'w1',
    name: 'Aldermoor',
    owners: ['u1'],
    kind: 'campaign',
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

  it('fills the rail with the Dashboard, Entities, Compendium, Assets and Graph links from the active World (ADR-0041)', () => {
    expect(railFor(world(['read'])).map((e) => e.testid)).toEqual([
      'nav-dashboard',
      'nav-entities',
      'nav-compendium',
      'nav-assets',
      'nav-world-graph',
    ]);
  });

  /** The World Graph is a read of the World, so it shows to anyone who can reach it (#181). */
  it('links the World Graph with the canonical slug-base62 route (ADR-0042)', () => {
    const graph = railFor(world(['read']))[4];
    expect(graph.link).toEqual(worldGraphRoute('w1', 'Aldermoor'));
  });

  /**
   * The Compendium is Instance-wide and belongs to no World (ADR-0078/0079), so the World in its link
   * is the **adoption target** rather than the content's home — and, being a read any signed-in caller
   * may make, it sits beside the Graph with no rights gate.
   */
  it('offers the Compendium to every reader, under the active World (ADR-0079)', () => {
    const compendium = railFor(world(['read']))[2];
    expect(compendium.link).toEqual(worldCompendiumRoute('w1', 'Aldermoor'));
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
      'nav-compendium',
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
