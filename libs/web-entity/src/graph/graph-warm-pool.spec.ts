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
    vi.stubGlobal('requestIdleCallback', (work: () => void) => work());
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
