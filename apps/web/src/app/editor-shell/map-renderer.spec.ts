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
  rotate(): void {
    this.ops.push('rotate');
  }
  /** The current font, textAlign and textBaseline — set before `fillText`. */
  font = '';
  textAlign = '';
  textBaseline = '';
  /** Each (text, fillStyle) drawn — only the asserted ones need inspecting. */
  readonly textFills: { text: string; fill: string }[] = [];
  fillText(text: string): void {
    this.textFills.push({ text, fill: this.fillStyle });
  }
  /** A deterministic width: half the font's pixel size per character. */
  measureText(text: string): { width: number } {
    return { width: text.length * (parseFloat(this.font) || 10) * 0.5 };
  }
  /** Grid strokes pass no path; a feature marker strokes an explicit Path2D. */
  readonly markerStrokes: string[] = [];
  /** The strokeStyle at each pathless stroke() — grid lines and region borders. */
  readonly lineStrokes: string[] = [];
  stroke(path?: unknown): void {
    if (path) this.markerStrokes.push(this.strokeStyle);
    else {
      this.ops.push('stroke');
      this.lineStrokes.push(this.strokeStyle);
    }
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
const LABEL_INK = 'rgb(7, 7, 7)';
const SELECT_INK = 'rgb(5, 5, 5)';

/** Drive the colour resolution so terrain fills are deterministic. */
function stubTheme(): () => void {
  const original = window.getComputedStyle;
  const colours: Record<string, string> = {
    '--terrain-forest': FOREST,
    '--feature-ink': FEATURE_INK,
    '--label-ink': LABEL_INK,
    '--gold-strong': SELECT_INK,
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
    const doc: HexMap = { hexes: { '0,0': { terrain: 'forest' } }, regions: [], labels: [] };

    renderer.render(camera, doc, null);

    expect(ctx.pathFills).toContain(FOREST);
    restore();
  });

  it('fills nothing when the map is all Void', () => {
    const restore = stubTheme();
    const ctx = new FakeContext();
    const renderer = makeRenderer(ctx);
    const camera = Camera.initial().panBy(60, 60);

    renderer.render(camera, { hexes: {}, regions: [], labels: [] }, null);

    expect(ctx.pathFills).toEqual([]);
    restore();
  });
});

describe('Canvas2dMapRenderer region borders', () => {
  it('outlines a region member hex in the region color rather than filling it', () => {
    const restore = stubTheme();
    const ctx = new FakeContext();
    const renderer = makeRenderer(ctx);
    const camera = Camera.initial().panBy(60, 60);
    const doc: HexMap = {
      hexes: {},
      regions: [
        { id: 'a', name: 'Avalon', color: '#b08a4e', hexes: { '0,0': true } },
      ],
      labels: [],
    };

    renderer.render(camera, doc, null);

    // The region reads as a coloured border (a stroke), not a surface tint.
    expect(ctx.lineStrokes).toContain('#b08a4e');
    expect(ctx.pathFills.some((f) => f.startsWith('#b08a4e'))).toBe(false);
    restore();
  });

  it('draws both regions borders on a hex that belongs to two of them', () => {
    const restore = stubTheme();
    const ctx = new FakeContext();
    const renderer = makeRenderer(ctx);
    const camera = Camera.initial().panBy(60, 60);
    const doc: HexMap = {
      hexes: {},
      regions: [
        { id: 'a', name: 'Avalon', color: '#b08a4e', hexes: { '0,0': true } },
        { id: 'b', name: 'Whisperwood', color: '#7c9b86', hexes: { '0,0': true } },
      ],
      labels: [],
    };

    renderer.render(camera, doc, null);

    // Each region strokes its own boundary, so overlaps stay legible.
    expect(ctx.lineStrokes).toContain('#b08a4e');
    expect(ctx.lineStrokes).toContain('#7c9b86');
    restore();
  });

  it('does not stroke a region border for an off-screen member', () => {
    const restore = stubTheme();
    const ctx = new FakeContext();
    const renderer = makeRenderer(ctx);
    const camera = Camera.initial().panBy(60, 60);
    const doc: HexMap = {
      hexes: { '0,0': { terrain: 'forest' } },
      regions: [
        { id: 'a', name: 'Avalon', color: '#b08a4e', hexes: { '5,5': true } },
      ],
      labels: [],
    };

    renderer.render(camera, doc, null);

    expect(ctx.lineStrokes).not.toContain('#b08a4e');
    restore();
  });

  it('skips the shared edge between two member hexes, drawing only the outer border', () => {
    const restore = stubTheme();
    const ctx = new FakeContext();
    const renderer = makeRenderer(ctx);
    const camera = Camera.initial().panBy(60, 60);
    // Two adjacent members ((0,0) and its east neighbour (1,0)) share one edge.
    const doc: HexMap = {
      hexes: {},
      regions: [
        { id: 'a', name: 'Avalon', color: '#b08a4e', hexes: { '0,0': true, '1,0': true } },
      ],
      labels: [],
    };

    renderer.render(camera, doc, null);

    // A lone hex has 6 boundary edges; two adjacent members share one edge, so
    // its two sides are interior and skipped — 12 - 2 = 10 boundary strokes.
    const borders = ctx.lineStrokes.filter((c) => c === '#b08a4e');
    expect(borders).toHaveLength(10);
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
      regions: [], labels: [],
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
    const doc: HexMap = { hexes: { '0,0': { terrain: 'forest' } }, regions: [], labels: [] };

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
      regions: [], labels: [],
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

describe('Canvas2dMapRenderer labels', () => {
  it('draws a label\'s text in the label ink at its world position', () => {
    const restore = stubTheme();
    const ctx = new FakeContext();
    const renderer = makeRenderer(ctx);
    const camera = Camera.initial().panBy(60, 60);
    const doc: HexMap = {
      hexes: {},
      regions: [],
      labels: [{ id: 'l1', text: 'The Whisperwood', position: { x: 0, y: 0 }, size: 28 }],
    };

    renderer.render(camera, doc, null);

    expect(ctx.textFills).toContainEqual({ text: 'The Whisperwood', fill: LABEL_INK });
    restore();
  });

  it('draws no label text when the map has none', () => {
    const restore = stubTheme();
    const ctx = new FakeContext();
    const renderer = makeRenderer(ctx);
    const camera = Camera.initial().panBy(60, 60);

    renderer.render(camera, { hexes: {}, regions: [], labels: [] }, null);

    expect(ctx.textFills).toEqual([]);
    restore();
  });

  it('hit-tests a screen point to the label drawn there', () => {
    const restore = stubTheme();
    const ctx = new FakeContext();
    const renderer = makeRenderer(ctx);
    // (0,0) world is at screen (60,60) under this camera — the label's centre.
    const camera = Camera.initial().panBy(60, 60);
    const doc: HexMap = {
      hexes: {},
      regions: [],
      labels: [{ id: 'l1', text: 'Open Sea', position: { x: 0, y: 0 }, size: 28 }],
    };
    renderer.render(camera, doc, null);

    expect(renderer.labelAt({ x: 60, y: 60 })).toBe('l1');
    restore();
  });

  it('keeps an empty-text label clickable at its centre', () => {
    const restore = stubTheme();
    const ctx = new FakeContext();
    const renderer = makeRenderer(ctx);
    // (0,0) world is at screen (60,60) under this camera — the label's centre.
    const camera = Camera.initial().panBy(60, 60);
    // Empty text measures 0 wide; the box must still floor to a clickable size
    // so the label can be re-selected to give it text back (issue #2).
    const doc: HexMap = {
      hexes: {},
      regions: [],
      labels: [{ id: 'l1', text: '', position: { x: 0, y: 0 }, size: 28 }],
    };
    renderer.render(camera, doc, null);

    expect(renderer.labelAt({ x: 60, y: 60 })).toBe('l1');
    restore();
  });

  it('hit-tests to null where no label was drawn', () => {
    const restore = stubTheme();
    const ctx = new FakeContext();
    const renderer = makeRenderer(ctx);
    const camera = Camera.initial().panBy(60, 60);
    const doc: HexMap = {
      hexes: {},
      regions: [],
      labels: [{ id: 'l1', text: 'Open Sea', position: { x: 0, y: 0 }, size: 28 }],
    };
    renderer.render(camera, doc, null);

    // Far from the label's centre at (60,60).
    expect(renderer.labelAt({ x: 600, y: 600 })).toBeNull();
    restore();
  });

  it('rotates a label drawn with a rotation', () => {
    const restore = stubTheme();
    const ctx = new FakeContext();
    const renderer = makeRenderer(ctx);
    const camera = Camera.initial().panBy(60, 60);
    const doc: HexMap = {
      hexes: {},
      regions: [],
      labels: [{ id: 'l1', text: 'Tilted', position: { x: 0, y: 0 }, size: 28, rotation: 30 }],
    };

    renderer.render(camera, doc, null);

    expect(ctx.ops).toContain('rotate');
    restore();
  });
});

describe('Canvas2dMapRenderer selection highlight', () => {
  it('outlines a selected hex in the selection colour', () => {
    const restore = stubTheme();
    const ctx = new FakeContext();
    const renderer = makeRenderer(ctx);
    const camera = Camera.initial().panBy(60, 60);
    const doc: HexMap = { hexes: { '0,0': { terrain: 'forest' } }, regions: [], labels: [] };

    renderer.render(camera, doc, null, null, { kind: 'hex', coord: { q: 0, r: 0 } });

    // The selected hex reads as a strong outline in the accent ink, distinct
    // from the soft hover fill and the thin grid line.
    expect(ctx.lineStrokes).toContain(SELECT_INK);
    restore();
  });

  it('draws a bounds outline around a selected label in the selection colour', () => {
    const restore = stubTheme();
    const ctx = new FakeContext();
    const renderer = makeRenderer(ctx);
    const camera = Camera.initial().panBy(60, 60);
    const doc: HexMap = {
      hexes: {},
      regions: [],
      labels: [{ id: 'l1', text: 'Open Sea', position: { x: 0, y: 0 }, size: 28 }],
    };

    renderer.render(camera, doc, null, null, { kind: 'label', id: 'l1' });

    expect(ctx.lineStrokes).toContain(SELECT_INK);
    restore();
  });

  it('draws no selection outline when nothing is selected', () => {
    const restore = stubTheme();
    const ctx = new FakeContext();
    const renderer = makeRenderer(ctx);
    const camera = Camera.initial().panBy(60, 60);
    const doc: HexMap = { hexes: { '0,0': { terrain: 'forest' } }, regions: [], labels: [] };

    renderer.render(camera, doc, null, null, null);

    expect(ctx.lineStrokes).not.toContain(SELECT_INK);
    restore();
  });
});
