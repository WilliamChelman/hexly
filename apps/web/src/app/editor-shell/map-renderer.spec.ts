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
  stroke(): void {
    this.ops.push('stroke');
  }
  fill(): void {
    this.pathFills.push(this.fillStyle);
  }
}

const LAYOUT: Layout = {
  orientation: 'pointy',
  size: { x: 40, y: 40 },
  origin: { x: 0, y: 0 },
};

const FOREST = 'rgb(1, 2, 3)';

/** Drive the colour resolution so terrain fills are deterministic. */
function stubTheme(): () => void {
  const original = window.getComputedStyle;
  const colours: Record<string, string> = { '--terrain-forest': FOREST };
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
