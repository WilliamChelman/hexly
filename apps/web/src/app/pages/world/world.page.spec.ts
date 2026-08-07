import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { WorldDetail, WorldVerb } from '@hexly/domain';
import { ActiveWorld, worldDashboardRoute, worldGraphRoute, worldLibraryRoute } from '@hexly/web-core';
import { provideTranslocoTesting } from '../../../testing/transloco-testing';
import { NavRailStore } from '../../shell/nav-rail.store';
import { EntityQuickOpen } from '../../entity-types/entity-quick-open';
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
      // The `/w/:worldId` route provides Entity Quick Open and this layout injects it to bring it to
      // life (ADR-0083); stubbed here — what it does once alive is its own spec's business.
      providers: [provideRouter([]), { provide: EntityQuickOpen, useValue: {} }],
    }).compileComponents();
  });

  /** Pin the World, mount the layout (running its effect), return the filled rail slot. */
  function railFor(detail: WorldDetail) {
    TestBed.inject(ActiveWorld).set(detail);
    TestBed.createComponent(WorldPage).detectChanges();
    return TestBed.inject(NavRailStore).entries();
  }

  it('fills the rail with the Dashboard, Entities, Library, Assets and Graph links from the active World (ADR-0041)', () => {
    expect(railFor(world(['read'])).map((e) => e.testid)).toEqual([
      'nav-dashboard',
      'nav-entities',
      'nav-library',
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
   * The Library sits beside Entities: what this World draws on, beside what its authors made
   * (ADR-0080). Its content lives in the Containers this World **Mounts**, so the World in its link is
   * whose Mounts these are and the **Adoption** target — and, being a read of the World, it needs no
   * rights gate.
   */
  it('offers the Library to every reader, beside Entities and under the active World (ADR-0080)', () => {
    const entries = railFor(world(['read']));
    expect(entries[1].testid).toBe('nav-entities');
    expect(entries[2].testid).toBe('nav-library');
    expect(entries[2].link).toEqual(worldLibraryRoute('w1', 'Aldermoor'));

    // A destination is only there if it reads as one in both Locales (ADR-0049): the rail renders the
    // key, so an untranslated one would ship the key itself as the label.
    const transloco = TestBed.inject(TranslocoService);
    expect(transloco.translate(entries[2].labelKey)).toBe('Library');
    transloco.setActiveLang('fr');
    expect(transloco.translate(entries[2].labelKey)).toBe('Bibliothèque');
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
      'nav-library',
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
