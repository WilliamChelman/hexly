import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { EntityType, WorldDetail, WorldGraph } from '@hexly/domain';
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

  /** Mount the page and answer its one fetch with `graph`, returning the mounted canvas's click output. */
  function open(graph: WorldGraph): { fixture: ComponentFixture<WorldGraphPage>; click: (id: string) => void } {
    const fixture = TestBed.createComponent(WorldGraphPage);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).expectOne('/api/worlds/w1/graph').flush(graph);
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

  it('opens the World’s own Entity under the World on screen', () => {
    open(LINKED_TO_A_SHELF).click('ealdred');

    expect(navigate).toHaveBeenCalledWith(entityRoute('w1', 'ealdred', 'Aldermoor', 'Ealdred'));
  });

  /**
   * The wrinkle this fixes: stamping the active World onto every clicked node landed a shelf monster in
   * Aldermoor's shell, which then resolved the Entity and disagreed with the rail around it.
   */
  it('opens a Foreign node under the Container it lives in, never the World on screen', () => {
    open(LINKED_TO_A_SHELF).click('goblin');

    expect(navigate).toHaveBeenCalledWith(entityRoute('w-shelf', 'goblin', undefined, 'Marauder Goblin'));
  });
});
