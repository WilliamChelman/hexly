import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@hexly/web-core';
import { GraphWarmPool, WARM_GRAPH_FACTORY, WarmGraph } from './graph-warm-pool';

describe('GraphWarmPool', () => {
  let built: WarmGraph[];
  let factory: ReturnType<typeof vi.fn<() => Promise<WarmGraph>>>;
  let resolveLost: () => void;

  const fakeWarm = (): WarmGraph => {
    let lose = () => {
      /* replaced by the promise executor below */
    };
    const lost = new Promise<void>((resolve) => (lose = resolve));
    resolveLost = lose;
    const warm = {
      graph: {} as WarmGraph['graph'],
      div: document.createElement('div'),
      lost,
      dispose: vi.fn(),
    };
    built.push(warm);
    return warm;
  };

  beforeEach(() => {
    built = [];
    factory = vi.fn(async () => fakeWarm());
    // Warm synchronously: the pool only asks the scheduler for a moment, and the moment is now.
    // Both halves of the pair — the pool declines an idle scheduler it could not cancel.
    vi.stubGlobal('requestIdleCallback', (work: () => void) => work());
    vi.stubGlobal('cancelIdleCallback', () => undefined);
    TestBed.configureTestingModule({
      providers: [{ provide: WARM_GRAPH_FACTORY, useValue: () => factory() }, Logger],
    });
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve));

  it('hands the warmed graph to the first claim, and nothing to the second', async () => {
    const pool = TestBed.inject(GraphWarmPool);
    pool.warmUp();
    await settle();

    const first = pool.claim();
    expect(first).toBe(built[0]);
    expect(pool.claim()).toBeNull();
  });

  it('claims nothing before the warm-up has run', () => {
    const pool = TestBed.inject(GraphWarmPool);
    expect(pool.claim()).toBeNull();
  });

  it('warms once for repeated warmUp calls', async () => {
    const pool = TestBed.inject(GraphWarmPool);
    pool.warmUp();
    pool.warmUp();
    await settle();
    pool.warmUp();
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('retire destroys the adopted graph and warms the next', async () => {
    const pool = TestBed.inject(GraphWarmPool);
    pool.warmUp();
    await settle();
    const adopted = pool.claim();

    pool.retire(adopted as WarmGraph);
    await settle();

    expect(adopted?.dispose).toHaveBeenCalled();
    expect(factory).toHaveBeenCalledTimes(2);
    expect(pool.claim()).toBe(built[1]);
  });

  it('a failed build falls back to self-hosting mounts and never retries', async () => {
    const pool = TestBed.inject(GraphWarmPool);
    const logger = TestBed.inject(Logger);
    const warned = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    factory.mockRejectedValueOnce(new Error('no WebGL'));

    pool.warmUp();
    await settle();
    pool.warmUp();
    await settle();

    expect(pool.claim()).toBeNull();
    expect(factory).toHaveBeenCalledTimes(1);
    expect(warned).toHaveBeenCalled();
  });

  // Nothing may outlive the injector: a warm-up that fires after teardown builds for an application
  // that is gone, and under vitest it lands in whichever spec happens to be running 1.5s later.
  describe('teardown', () => {
    it('un-schedules a pending warm-up when the injector is destroyed', () => {
      const scheduled: (() => void)[] = [];
      vi.stubGlobal('requestIdleCallback', (work: () => void) => {
        scheduled.push(work);
        return 7;
      });
      const cancel = vi.fn();
      vi.stubGlobal('cancelIdleCallback', cancel);
      TestBed.inject(GraphWarmPool).warmUp();

      TestBed.resetTestingModule();

      expect(cancel).toHaveBeenCalledWith(7);
      // The handle is cancelled; were the environment to run it anyway, it must still build nothing.
      scheduled[0]?.();
      expect(factory).not.toHaveBeenCalled();
    });

    it('disposes a graph that finishes building after the injector is destroyed', async () => {
      const pool = TestBed.inject(GraphWarmPool);
      let finish = (_: WarmGraph) => undefined as void;
      factory.mockReturnValueOnce(new Promise<WarmGraph>((resolve) => (finish = resolve)));
      pool.warmUp();

      TestBed.resetTestingModule();
      const late = fakeWarm();
      finish(late);
      await settle();

      expect(late.dispose).toHaveBeenCalled();
    });

    it('disposes the graph it is holding when the injector is destroyed', async () => {
      TestBed.inject(GraphWarmPool).warmUp();
      await settle();

      TestBed.resetTestingModule();

      expect(built[0].dispose).toHaveBeenCalled();
    });
  });

  // jsdom has no WebGL2, so the default factory must refuse before it pulls in the renderer.
  it('refuses to build where WebGL2 is unavailable, without loading the renderer', async () => {
    TestBed.resetTestingModule();
    const build = TestBed.inject(WARM_GRAPH_FACTORY);

    await expect(build()).rejects.toThrow(/WebGL2/);
  });

  it('discards a pooled graph whose GPU context is lost and warms a fresh one', async () => {
    const pool = TestBed.inject(GraphWarmPool);
    pool.warmUp();
    await settle();

    resolveLost();
    await settle();

    expect(built[0].dispose).toHaveBeenCalled();
    await settle();
    expect(pool.claim()).toBe(built[1]);
  });
});
