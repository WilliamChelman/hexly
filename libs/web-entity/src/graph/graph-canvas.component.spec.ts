import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Graph } from '@cosmos.gl/graph';
import { WorldGraph } from '@hexly/domain';
import { provideTranslocoTesting } from '@hexly/web-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WEB_ENTITY_TEST_CATALOGS } from '../i18n/test-catalogs';
import { provideEntityTypesTesting } from '../testing';
import { GraphCanvasComponent } from './graph-canvas.component';
import { GraphWarmPool, WARM_GRAPH_FACTORY, WarmGraph } from './graph-warm-pool';

// cosmos.gl's real module cannot even be imported under jsdom (its luma.gl dependency reaches for WebGPU
// reflection at load time). The canvas only reads `Graph` from it to *build* one, which an adopted mount
// never does.
vi.mock('@cosmos.gl/graph', () => ({
  Graph: class {
    constructor() {
      throw new Error('the spec adopts a pooled graph; nothing here should build one');
    }
  },
}));

/** A World of `nodes`, linked by `edges` given as `'source>target'`. */
function world(nodes: string[], edges: string[] = []): WorldGraph {
  return {
    nodes: nodes.map((name) => ({ id: name.toLowerCase(), name, types: ['core.type.note'] })),
    edges: edges.map((edge) => {
      const [source, target] = edge.split('>');
      return { source, target, descriptor: null, decor: false };
    }),
  };
}

/**
 * A stand-in for cosmos.gl's `Graph`, handed to the canvas through the warm pool's factory seam — the
 * one way to give the component a graph without a WebGL context, and the same path a real adoption takes.
 */
function fakeCosmos() {
  let positions: number[] = [];
  return {
    setConfig: vi.fn(),
    setConfigPartial: vi.fn(),
    setPointPositions: vi.fn((next: Float32Array) => (positions = [...next])),
    setPointSizes: vi.fn(),
    setPointColors: vi.fn(),
    setLinks: vi.fn(),
    setLinkColors: vi.fn(),
    setPinnedPoints: vi.fn(),
    getPointPositions: vi.fn(() => positions),
    getNeighboringPointIndices: vi.fn(() => [] as number[]),
    spaceToScreenPosition: vi.fn(([x, y]: [number, number]) => [x, y]),
    screenToSpacePosition: vi.fn(([x, y]: [number, number]) => [x, y]),
    setZoomTransformByPointPositions: vi.fn(),
    fitView: vi.fn(),
    render: vi.fn(),
    start: vi.fn(),
    unpause: vi.fn(),
    pause: vi.fn(),
    destroy: vi.fn(),
    isSimulationRunning: false,
  };
}

@Component({
  selector: 'app-graph-canvas-host',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GraphCanvasComponent],
  template: `<app-graph-canvas [graph]="graph()" [center]="center()" />`,
})
class HostComponent {
  readonly graph = signal<WorldGraph>(world(['Ealdred', 'Mira'], ['ealdred>mira']));
  readonly center = signal<string | null>('ealdred');
}

/**
 * The renderer's *mount lifecycle* — what these specs pin is that new data is drawn through the graph
 * already on screen. Rebuilding it would recreate a WebGL context and recompile cosmos.gl's shaders on
 * the main thread, which is exactly the cost every depth flip and decor reveal must not pay (ADR-0072).
 */
describe('GraphCanvasComponent', () => {
  let cosmos: ReturnType<typeof fakeCosmos>;
  let warm: WarmGraph;
  let pool: GraphWarmPool;
  let retire: ReturnType<typeof vi.spyOn>;
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  const settle = () => new Promise((resolve) => setTimeout(resolve));

  /** The mount is async (a dynamic import); give it as many turns as it needs to draw. */
  const drawn = async () => {
    for (let turn = 0; turn < 50 && cosmos.setPointPositions.mock.calls.length === 0; turn++) await settle();
    expect(cosmos.setPointPositions).toHaveBeenCalled();
  };

  /** The point count of the most recent seeding — two floats per point. */
  const seededPoints = () => {
    const calls = cosmos.setPointPositions.mock.calls;
    return calls[calls.length - 1][0].length / 2;
  };

  const lastPinned = () => {
    const calls = cosmos.setPinnedPoints.mock.calls;
    return calls[calls.length - 1]?.[0] ?? null;
  };

  beforeEach(async () => {
    cosmos = fakeCosmos();
    warm = {
      graph: cosmos as unknown as Graph,
      div: document.createElement('div'),
      lost: new Promise<void>(() => undefined),
      dispose: vi.fn(),
    };
    // Warm synchronously: the pool only asks the scheduler for a moment, and the moment is now.
    vi.stubGlobal('requestIdleCallback', (work: () => void) => work());

    await TestBed.configureTestingModule({
      imports: [HostComponent, provideTranslocoTesting(WEB_ENTITY_TEST_CATALOGS)],
      providers: [
        provideEntityTypesTesting([]),
        { provide: WARM_GRAPH_FACTORY, useValue: () => Promise.resolve(warm) },
      ],
    }).compileComponents();

    pool = TestBed.inject(GraphWarmPool);
    retire = vi.spyOn(pool, 'retire');
    pool.warmUp();
    await settle();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    await drawn();
  });

  afterEach(() => {
    fixture.destroy();
    vi.unstubAllGlobals();
  });

  it('adopts the warm graph rather than building one of its own', () => {
    expect(cosmos.setConfig).toHaveBeenCalledTimes(1);
    expect(seededPoints()).toBe(2);
  });

  /** The headline: a depth flip re-seeds the live graph, and nothing is torn down. */
  it('re-seeds the live graph when the data changes, without tearing the mount down', () => {
    const canvasEl = fixture.nativeElement.querySelector('[data-testid=graph-canvas]');

    host.graph.set(world(['Ealdred', 'Mira', 'Thornwood'], ['ealdred>mira', 'mira>thornwood']));
    fixture.detectChanges();

    expect(retire).not.toHaveBeenCalled();
    expect(warm.dispose).not.toHaveBeenCalled();
    expect(cosmos.destroy).not.toHaveBeenCalled();
    // The same graph, reconfigured once (at adoption) and seeded again with the wider neighbourhood.
    expect(cosmos.setConfig).toHaveBeenCalledTimes(1);
    expect(seededPoints()).toBe(3);
    expect(cosmos.setLinks).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.querySelector('[data-testid=graph-canvas]')).toBe(canvasEl);
  });

  /** The centre keeps its id across a swap but not its point index — `graphPayload` orders by degree. */
  it('re-pins the centre at its new point index', () => {
    expect(lastPinned()).toEqual([0]);

    // A second neighbour makes Ealdred the highest-degree node, which moves it to the last point index.
    host.graph.set(world(['Ealdred', 'Mira', 'Thornwood'], ['ealdred>mira', 'ealdred>thornwood']));
    fixture.detectChanges();

    expect(lastPinned()).toEqual([2]);
  });

  /**
   * The settle mark is a claim about the payload on screen (the e2e hook), so a swap stands it down
   * until the new layout has cooled.
   */
  it('stands the settle mark down for the new payload', () => {
    const canvas = fixture.nativeElement.querySelector('[data-testid=graph-canvas]') as HTMLElement;
    canvas.dataset['settled'] = 'true';

    host.graph.set(world(['Ealdred', 'Mira', 'Thornwood'], ['ealdred>mira', 'mira>thornwood']));
    fixture.detectChanges();

    expect(canvas.dataset['settled']).toBeUndefined();
  });

  /**
   * A different neighbourhood needs a real layout; the same Entities drawn with different edges (a decor
   * reveal) only need a nudge, or a checkbox would re-scatter the picture the reader is reading.
   */
  it('runs a full layout for a new node set and only a nudge for new edges', () => {
    host.graph.set(world(['Ealdred', 'Mira', 'Thornwood'], ['ealdred>mira', 'mira>thornwood']));
    fixture.detectChanges();
    expect(cosmos.start).toHaveBeenLastCalledWith(1);

    host.graph.set(world(['Ealdred', 'Mira', 'Thornwood'], ['ealdred>mira', 'mira>thornwood', 'ealdred>thornwood']));
    fixture.detectChanges();
    expect(cosmos.start.mock.lastCall?.[0]).toBeLessThan(1);
  });

  /** An empty drawing is not a drawing: the mount goes back to the pool rather than being swapped to nothing. */
  it('gives the graph back when the World empties', () => {
    host.graph.set(world([]));
    fixture.detectChanges();

    expect(retire).toHaveBeenCalledWith(warm);
  });

  it('gives the graph back to the pool when the component goes', () => {
    fixture.destroy();

    expect(retire).toHaveBeenCalledWith(warm);
    expect(cosmos.destroy).not.toHaveBeenCalled();
  });
});
