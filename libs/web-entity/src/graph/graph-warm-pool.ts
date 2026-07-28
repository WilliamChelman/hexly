import { DestroyRef, Injectable, InjectionToken, inject } from '@angular/core';
import type { Graph } from '@cosmos.gl/graph';
import { Logger } from '@hexly/web-core';

/**
 * A pre-warmed, already-rendered graph for a mount to adopt — the canvas (and its WebGL context)
 * lives inside `div`, which the adopter re-parents into its own host.
 */
export interface WarmGraph {
  readonly graph: Graph;
  readonly div: HTMLDivElement;
  /** Resolves if the GPU drops the context — the entry is then dead. */
  readonly lost: Promise<void>;
  /**
   * Tear down everything the warm-up built: the graph, its device, its div. The pool's to call — an
   * adopter hands the entry back to {@link GraphWarmPool.retire} instead.
   */
  readonly dispose: () => void;
}

/** Builds one warm graph. A seam so unit tests never touch WebGL; the default does the real thing. */
export const WARM_GRAPH_FACTORY = new InjectionToken<() => Promise<WarmGraph>>('WARM_GRAPH_FACTORY', {
  providedIn: 'root',
  factory: () => buildWarmGraph,
});

async function buildWarmGraph(): Promise<WarmGraph> {
  // Checked before the imports, not after: where WebGL2 is absent the device call could only fail,
  // and pulling in the renderer's module graph to learn that costs a jsdom test run real time.
  if (typeof WebGL2RenderingContext === 'undefined') throw new Error('WebGL2 is unavailable here');
  const [{ Graph }, { luma }, { webgl2Adapter }] = await Promise.all([
    import('@cosmos.gl/graph'),
    import('@luma.gl/core'),
    import('@luma.gl/webgl'),
  ]);
  // The same device cosmos.gl would build for itself; injecting it makes `Graph.destroy()` spare it.
  const device = await luma.createDevice({
    type: 'webgl',
    adapters: [webgl2Adapter],
    createCanvasContext: {
      canvas: document.createElement('canvas'),
      useDevicePixels: window.devicePixelRatio || 2,
      autoResize: true,
    },
  });
  const div = document.createElement('div');
  // Offscreen but laid out: a display-none host would size the canvas to zero and skip the draw.
  div.style.cssText = 'position:fixed;left:-10000px;top:0;width:320px;height:320px;';
  document.body.appendChild(div);
  try {
    const graph = new Graph(div, { fitViewOnInit: false }, Promise.resolve(device));
    await graph.ready;
    // The shaders compile on the first *painted* frames, so draw a two-point graph before parking.
    graph.setPointPositions(new Float32Array([0, 0, 10, 10]));
    graph.setLinks(new Float32Array([0, 1]));
    graph.render();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    graph.pause();
    return {
      graph,
      div,
      lost: device.lost.then(() => undefined),
      dispose: () => {
        graph.destroy();
        void device.destroy();
        div.remove();
      },
    };
  } catch (err) {
    void device.destroy();
    div.remove();
    throw err;
  }
}

/** Where `requestIdleCallback` is missing (jsdom, old Safari), warm on a timer instead. */
const IDLE_FALLBACK_MS = 1500;

/**
 * Schedule `work` for an idle moment; the returned callback un-schedules it if it has not run.
 * Idle scheduling is taken only where it can also be cancelled, and the canceller is held from that
 * moment rather than looked up again later — cancelling happens during teardown, when whatever is
 * dismantling the environment may already have taken the global away.
 */
function onIdle(work: () => void): () => void {
  if (typeof requestIdleCallback === 'function' && typeof cancelIdleCallback === 'function') {
    const cancel = cancelIdleCallback.bind(globalThis);
    const handle = requestIdleCallback(() => work());
    return () => cancel(handle);
  }
  const timer = setTimeout(work, IDLE_FALLBACK_MS);
  return () => clearTimeout(timer);
}

/**
 * One pre-warmed cosmos.gl graph, built during browser idle time and adopted by the next mount.
 *
 * A graph's first render blocks the main thread for hundreds of milliseconds — WebGL context
 * creation plus shader compilation — and the driver repeats the compile for every `new Graph`,
 * even on a reused context (measured; ANGLE caches nothing across instances). So the only way to
 * open the Local Graph Panel (ADR-0072) without freezing the page is to hand the mount a graph
 * that has already rendered once: a surface that may soon draw one calls {@link warmUp}; the mount
 * {@link claim}s the live instance and reconfigures it, and hands it back to {@link retire} when it is
 * done. Everything handed out stays the pool's to tear down — the graph, its device and its div.
 *
 * **A retired graph is destroyed, never handed out again**: cosmos.gl has no reset. `randomSeed` and
 * `initialZoomLevel` are init-only — `setConfig` restores whatever the instance was constructed with —
 * so a second adopter could not be given the deterministic layout the canvas configures, and would
 * inherit the previous drawing's simulation seed. The pool warms a fresh one at the next idle instead.
 *
 * A miss ({@link claim} returning `null`) is always safe — the mount then builds its own graph,
 * exactly as it would without the pool.
 */
@Injectable({ providedIn: 'root' })
export class GraphWarmPool {
  private readonly build = inject(WARM_GRAPH_FACTORY);
  private readonly logger = inject(Logger);

  private warm: WarmGraph | null = null;
  private warming = false;
  private failed = false;
  private destroyed = false;
  private unschedule: (() => void) | null = null;

  constructor() {
    // Nothing the pool schedules may outlive the injector that owns it: an idle callback that fires
    // after teardown builds a graph for an application that is gone — and in a unit test, lands its
    // work in the next spec's environment. The pooled graph goes with it; it holds a GPU context.
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.unschedule?.();
      this.unschedule = null;
      this.warm?.dispose();
      this.warm = null;
    });
  }

  /** Schedule a warm graph for an idle stretch. Idempotent; a no-op once one exists or the build failed. */
  warmUp(): void {
    if (this.destroyed || this.warm || this.warming || this.failed) return;
    this.warming = true;
    this.unschedule = onIdle(() => {
      this.unschedule = null;
      // Belt and braces around the cancellation: a scheduler that fires a cancelled callback anyway
      // (or one whose cancel the platform ignores) still must not build for a dead injector.
      if (this.destroyed) return;
      void this.buildWarm();
    });
  }

  /** The warm graph, or `null` when none is ready. */
  claim(): WarmGraph | null {
    const warm = this.warm;
    this.warm = null;
    return warm;
  }

  /** Take an adopted graph back and destroy it — it cannot be re-pooled (see the class doc) — then warm the next. */
  retire(adopted: WarmGraph): void {
    adopted.dispose();
    this.warmUp();
  }

  private async buildWarm(): Promise<void> {
    try {
      const warm = await this.build();
      // The injector can go while the build is in flight; the graph it produced is still ours to tear down.
      if (this.destroyed) {
        warm.dispose();
        return;
      }
      // A GPU reset kills the pooled context: discard the dead entry and warm a fresh one.
      void warm.lost.then(() => {
        if (this.warm === warm) {
          this.warm = null;
          warm.dispose();
          this.warmUp();
        }
      });
      this.warm = warm;
    } catch (err) {
      this.failed = true;
      this.logger.warn('Graph warm-up failed; graphs will build on open', err);
    } finally {
      this.warming = false;
    }
  }
}
