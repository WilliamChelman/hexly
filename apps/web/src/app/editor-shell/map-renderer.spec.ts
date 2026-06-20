import { HexMap, Layout } from '@hexly/domain';
import { Camera } from './camera';
import { Canvas2dMapRenderer } from './map-renderer';

/** A 2D context stand-in that records each path fill and the colour used. */
class FakeContext {
  fillStyle = '';
  strokeStyle = '';
  lineWidth = 0;
  /** Every drawing call, in order — only the asserted ones need inspecting. */
  readonly ops: string[] = [];
  /** The fillStyle in effect at each `fill()` (path fills, not `fillRect`). */
  readonly pathFills: string[] = [];

  setTransform(): void {
    this.ops.push('setTransform');
  }
  fillRect(): void {
    this.ops.push('fillRect');
  }
  beginPath(): void {
    this.ops.push('beginPath');
  }
  moveTo(): void {
    this.ops.push('moveTo');
  }
  lineTo(): void {
    this.ops.push('lineTo');
  }
  closePath(): void {
    this.ops.push('closePath');
  }
  save(): void {
    this.ops.push('save');
  }
  restore(): void {
    this.ops.push('restore');
  }
  translate(): void {
    this.ops.push('translate');
  }
  scale(): void {
    this.ops.push('scale');
  }
  /** Grid strokes pass no path; a feature marker strokes an explicit Path2D. */
  readonly markerStrokes: string[] = [];
  stroke(path?: unknown): void {
    if (path) this.markerStrokes.push(this.strokeStyle);
    else this.ops.push('stroke');
  }
  fill(): void {
    this.pathFills.push(this.fillStyle);
  }
}

/** Stand-in for `Path2D`, absent in the test DOM — records the SVG path it got. */
class FakePath2D {
  constructor(readonly d: string) {}
}

/** Install a `Path2D` global so the renderer can build marker paths under test. */
function stubPath2D(): () => void {
  const original = (globalThis as { Path2D?: unknown }).Path2D;
  (globalThis as { Path2D?: unknown }).Path2D = FakePath2D;
  return () => {
    (globalThis as { Path2D?: unknown }).Path2D = original;
  };
}

const LAYOUT: Layout = {
  orientation: 'pointy',
  size: { x: 40, y: 40 },
  origin: { x: 0, y: 0 },
};

const FOREST = 'rgb(1, 2, 3)';
const FEATURE_INK = 'rgb(9, 9, 9)';

/** Drive the colour resolution so terrain fills are deterministic. */
function stubTheme(): () => void {
  const original = window.getComputedStyle;
  const colours: Record<string, string> = {
    '--terrain-forest': FOREST,
    '--feature-ink': FEATURE_INK,
  };
  window.getComputedStyle = (() => ({
    getPropertyValue: (name: string) => colours[name] ?? '',
  })) as unknown as typeof window.getComputedStyle;
  return () => {
    window.getComputedStyle = original;
  };
}

function makeRenderer(ctx: FakeContext) {
  const canvas = {
    getContext: () => ctx,
    style: {},
  } as unknown as HTMLCanvasElement;
  const renderer = new Canvas2dMapRenderer(canvas, LAYOUT);
  renderer.resize(120, 120);
  return renderer;
}

describe('Canvas2dMapRenderer painted terrain', () => {
  it('fills a painted hex with its terrain colour', () => {
    const restore = stubTheme();
    const ctx = new FakeContext();
    const renderer = makeRenderer(ctx);
    // Centre hex (0,0) under the camera so it is on screen.
    const camera = Camera.initial().panBy(60, 60);
    const doc: HexMap = { hexes: { '0,0': { terrain: 'forest' } } };

    renderer.render(camera, doc, null);

    expect(ctx.pathFills).toContain(FOREST);
    restore();
  });

  it('fills nothing when the map is all Void', () => {
    const restore = stubTheme();
    const ctx = new FakeContext();
    const renderer = makeRenderer(ctx);
    const camera = Camera.initial().panBy(60, 60);

    renderer.render(camera, { hexes: {} }, null);

    expect(ctx.pathFills).toEqual([]);
    restore();
  });
});

describe('Canvas2dMapRenderer feature markers', () => {
  it('strokes a feature marker in the feature ink on a hex that carries one', () => {
    const restoreTheme = stubTheme();
    const restorePath = stubPath2D();
    const ctx = new FakeContext();
    const renderer = makeRenderer(ctx);
    const camera = Camera.initial().panBy(60, 60);
    const doc: HexMap = {
      hexes: { '0,0': { terrain: 'forest', feature: { ref: 'settlement' } } },
    };

    renderer.render(camera, doc, null);

    expect(ctx.markerStrokes).toContain(FEATURE_INK);
    restorePath();
    restoreTheme();
  });

  it('draws no marker on a painted hex that has no feature', () => {
    const restoreTheme = stubTheme();
    const restorePath = stubPath2D();
    const ctx = new FakeContext();
    const renderer = makeRenderer(ctx);
    const camera = Camera.initial().panBy(60, 60);
    const doc: HexMap = { hexes: { '0,0': { terrain: 'forest' } } };

    renderer.render(camera, doc, null);

    expect(ctx.markerStrokes).toEqual([]);
    restorePath();
    restoreTheme();
  });

  it('balances save/restore so the round join/cap do not leak to the next frame', () => {
    const restoreTheme = stubTheme();
    const restorePath = stubPath2D();
    const ctx = new FakeContext();
    const renderer = makeRenderer(ctx);
    const camera = Camera.initial().panBy(60, 60);
    const doc: HexMap = {
      hexes: { '0,0': { terrain: 'forest', feature: { ref: 'settlement' } } },
    };

    renderer.render(camera, doc, null);

    const saves = ctx.ops.filter((op) => op === 'save').length;
    const restores = ctx.ops.filter((op) => op === 'restore').length;
    expect(saves).toBe(restores);
    expect(saves).toBeGreaterThan(0);
    restorePath();
    restoreTheme();
  });
});
