import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { EntityType, Mount, WorldDetail, WorldGraph } from '@hexly/domain';
import { ActiveWorld, entityRoute } from '@hexly/web-core';
import { GraphCanvasComponent } from '@hexly/web-entity';
import { provideEntityTypesTesting } from '@hexly/web-entity/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { provideTranslocoTesting } from '../../../../../testing/transloco-testing';
import { WorldGraphPage } from './world-graph.page';

// cosmos.gl's real module cannot be imported under jsdom (luma.gl reaches for WebGPU reflection at load
// time). The page never builds a graph itself; the canvas's own mount failure is caught and logged.
vi.mock('@cosmos.gl/graph', () => ({
  Graph: class {
    constructor() {
      throw new Error('no WebGL here');
    }
  },
}));

const NOTE = 'core.type.note' as EntityType;

const ALDERMOOR: WorldDetail = {
  id: 'w1',
  name: 'Aldermoor',
  owners: ['u1'],
  kind: 'campaign',
  rights: ['read'],
  entityCount: 2,
  pinnedEntityIds: [],
  seq: 1,
  createdAt: 1,
  updatedAt: 1,
};

/** Take the Router's `navigate` over, so a click is asserted as the route it would have gone to. */
function spyOnNavigate() {
  return vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
}

/**
 * The World Graph page's one navigation decision. Entity URLs are World-scoped (ADR-0028), so a
 * **Foreign node** — an Entity this World merely points into (ADR-0080) — must be opened under *its*
 * Container, not the World whose graph is on screen.
 */
describe('WorldGraphPage', () => {
  let navigate: ReturnType<typeof spyOnNavigate>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WorldGraphPage, provideTranslocoTesting()],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), provideEntityTypesTesting([])],
    }).compileComponents();
    TestBed.inject(ActiveWorld).set(ALDERMOOR);
    navigate = spyOnNavigate();
  });

  /**
   * Mount the page, answer its graph fetch, and answer the Mount read it makes when the payload holds a
   * **Foreign node** — matched rather than expected, since a World with none has nothing to place and
   * asks nothing. Returns the mounted canvas's click output.
   */
  function open(
    graph: WorldGraph,
    mounts: Mount[] = [],
  ): { fixture: ComponentFixture<WorldGraphPage>; click: (id: string) => void } {
    const fixture = TestBed.createComponent(WorldGraphPage);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/worlds/w1/graph').flush(graph);
    http.match('/api/worlds/w1/mounts').forEach((req) => req.flush(mounts));
    fixture.detectChanges();
    const canvas = fixture.debugElement.children
      .flatMap((child) => child.queryAll((node) => node.componentInstance instanceof GraphCanvasComponent))
      .at(0);
    return {
      fixture,
      click: (id: string) => (canvas?.componentInstance as GraphCanvasComponent).open.emit({ id, newTab: false }),
    };
  }

  const LINKED_TO_A_SHELF: WorldGraph = {
    nodes: [
      { id: 'ealdred', name: 'Ealdred', types: [NOTE] },
      { id: 'goblin', name: 'Marauder Goblin', types: [NOTE], foreignContainerId: 'w-shelf' },
    ],
    edges: [{ source: 'ealdred', target: 'goblin', descriptor: 'hunts', decor: false }],
  };

  /** A **Shelf** is a World (ADR-0080) — the one kind of Container that may stand in a `:worldId` segment. */
  const SHELF: Mount = { containerId: 'w-shelf', name: 'The Long Shelf', kind: 'world' };

  const LINKED_TO_A_PACK: WorldGraph = {
    nodes: [
      { id: 'ealdred', name: 'Ealdred', types: [NOTE] },
      { id: 'ogre', name: 'Ogre', types: [NOTE], foreignContainerId: 'c-bestiary' },
    ],
    edges: [{ source: 'ealdred', target: 'ogre', descriptor: 'fears', decor: false }],
  };

  const BESTIARY: Mount = { containerId: 'c-bestiary', name: 'Bestiary', kind: 'compendium' };

  /**
   * A **Foreign node** is drawn, never counted (#406, ADR-0080): mounting a two-thousand-entry pack
   * must not restate how big this campaign is.
   */
  it('counts this World’s own Entities and leaves the Foreign ones out', () => {
    const { fixture } = open({
      nodes: [
        { id: 'ealdred', name: 'Ealdred', types: [NOTE] },
        { id: 'moorwatch', name: 'Moorwatch', types: [NOTE] },
        { id: 'goblin', name: 'Marauder Goblin', types: [NOTE], foreignContainerId: 'w-shelf' },
      ],
      edges: [
        { source: 'ealdred', target: 'moorwatch', descriptor: null, decor: false },
        { source: 'ealdred', target: 'goblin', descriptor: 'hunts', decor: false },
      ],
    });

    const counts = (fixture.nativeElement as HTMLElement).querySelector('[data-testid=graph-counts]');
    expect(counts?.textContent?.trim()).toBe('2 entities · 2 links');
  });

  it('opens the World’s own Entity under the World on screen', () => {
    open(LINKED_TO_A_SHELF, [SHELF]).click('ealdred');

    expect(navigate).toHaveBeenCalledWith(entityRoute('w1', 'ealdred', 'Aldermoor', 'Ealdred'));
  });

  /**
   * The wrinkle this fixes: stamping the active World onto every clicked node landed a shelf monster in
   * Aldermoor's shell, which then resolved the Entity and disagreed with the rail around it.
   */
  it('opens a Foreign node under the Container it lives in, never the World on screen', () => {
    open(LINKED_TO_A_SHELF, [SHELF]).click('goblin');

    expect(navigate).toHaveBeenCalledWith(entityRoute('w-shelf', 'goblin', undefined, 'Marauder Goblin'));
  });

  /**
   * The other half of the same question (#406): a **Compendium** is not a World (ADR-0079), so its id in
   * the `:worldId` segment activates a World shell with no World behind it — dead rail, no Settings, a
   * `?` in the Switcher. A **Sealed** entry opens under the World reading it, as the Library's cards and
   * Quick Open open one.
   */
  it('opens a Compendium-homed Foreign node under the World on screen, never under the pack', () => {
    open(LINKED_TO_A_PACK, [BESTIARY]).click('ogre');

    expect(navigate).toHaveBeenCalledWith(entityRoute('w1', 'ogre', 'Aldermoor', 'Ogre'));
  });

  /**
   * **Adoption** copies links verbatim (ADR-0080), so a Foreign node can name a Container this World does
   * not Mount and nothing on screen can say what kind it is. The World on screen keeps the segment, where
   * `reconcileWorldSegment` corrects it for a target that turns out to have a World of its own.
   */
  it('keeps the World on screen for a Foreign node in a Container this World does not Mount', () => {
    open(LINKED_TO_A_SHELF).click('goblin');

    expect(navigate).toHaveBeenCalledWith(entityRoute('w1', 'goblin', 'Aldermoor', 'Marauder Goblin'));
  });
});
