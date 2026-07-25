import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  cascadedFrom,
  DEFAULT_WINDOW_SIZE,
  type GeometryWindow,
  readWindowState,
  rememberGeometry,
  restoredPlacement,
  type WindowBounds,
  type WindowState,
  writeWindowState,
} from './window-state';

/** One 1920×1080 screen with a menu bar, which is the shape of `screen.getAllDisplays()` we read. */
const LAPTOP: WindowBounds = { x: 0, y: 25, width: 1920, height: 1055 };
/** A second screen to the left, so a negative x is a legitimate position rather than nonsense. */
const LEFT_OF_IT: WindowBounds = { x: -1920, y: 0, width: 1920, height: 1080 };

function state(bounds: WindowBounds, maximized = false): WindowState {
  return { bounds, maximized };
}

/** A `BrowserWindow` stand-in whose geometry and events a spec drives. */
function fakeWindow(bounds: WindowBounds): GeometryWindow & {
  bounds: WindowBounds;
  maximized: boolean;
  fullScreen: boolean;
  emit(event: string): void;
} {
  const listeners = new Map<string, (() => void)[]>();
  return {
    bounds,
    maximized: false,
    fullScreen: false,
    getNormalBounds: function () {
      return this.bounds;
    },
    isMaximized: function () {
      return this.maximized;
    },
    isFullScreen: function () {
      return this.fullScreen;
    },
    on(event, listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return this;
    },
    emit(event) {
      for (const listener of listeners.get(event) ?? []) listener();
    },
  };
}

describe('restoredPlacement', () => {
  it('reopens at the geometry the last launch was left at', () => {
    const left = state({ x: 120, y: 80, width: 1000, height: 700 }, true);

    expect(restoredPlacement(left, [LAPTOP])).toEqual({ x: 120, y: 80, width: 1000, height: 700, maximized: true });
  });

  it('accepts a position on a second screen, negative coordinates included', () => {
    const onTheLeftScreen = { x: -1200, y: 100, width: 1000, height: 700 };

    expect(restoredPlacement(state(onTheLeftScreen), [LAPTOP, LEFT_OF_IT])).toMatchObject(onTheLeftScreen);
  });

  it('falls back to a centred default with nothing remembered', () => {
    expect(restoredPlacement(undefined, [LAPTOP])).toEqual({ ...DEFAULT_WINDOW_SIZE, maximized: false });
  });

  it('drops geometry that no longer lands on any screen', () => {
    const onTheScreenThatLeft = state({ x: -1200, y: 100, width: 1000, height: 700 });

    expect(restoredPlacement(onTheScreenThatLeft, [LAPTOP])).toEqual({ ...DEFAULT_WINDOW_SIZE, maximized: false });
  });

  it('keeps a window only slightly off the edge, where the title bar is still reachable', () => {
    const mostlyOff = state({ x: 1820, y: 200, width: 1000, height: 700 });

    expect(restoredPlacement(mostlyOff, [LAPTOP])).toMatchObject({ x: 1820, y: 200 });
  });
});

describe('cascadedFrom', () => {
  it('offsets the new window from the one it was opened from, at the same size', () => {
    const placement = cascadedFrom({ x: 100, y: 100, width: 1000, height: 700 }, [LAPTOP]);

    expect(placement).toEqual({ x: 132, y: 132, width: 1000, height: 700, maximized: false });
  });

  /** Not centred: an opener that is itself centred would put the new window exactly where it already is. */
  it('cascades up and to the left when down and to the right would run off the screen', () => {
    const atTheBottomRight = { x: 900, y: 370, width: 1000, height: 700 };

    expect(cascadedFrom(atTheBottomRight, [LAPTOP])).toEqual({
      x: 868,
      y: 338,
      width: 1000,
      height: 700,
      maximized: false,
    });
  });

  it('keeps the size and lets the platform place it when the opener already fills the screen', () => {
    expect(cascadedFrom(LAPTOP, [LAPTOP])).toEqual({ width: LAPTOP.width, height: LAPTOP.height, maximized: false });
  });
});

describe('rememberGeometry', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  it('coalesces a resize drag into one write', () => {
    const saved: WindowState[] = [];
    const window = fakeWindow({ x: 0, y: 25, width: 800, height: 600 });
    rememberGeometry(window, (s) => void saved.push(s));

    for (let frame = 0; frame < 30; frame++) {
      window.bounds = { ...window.bounds, width: 800 + frame };
      window.emit('resize');
    }
    vi.advanceTimersByTime(1000);

    expect(saved).toEqual([{ bounds: { x: 0, y: 25, width: 829, height: 600 }, maximized: false }]);
  });

  it('records a maximize as such, keeping the rectangle to un-maximize into', () => {
    const saved: WindowState[] = [];
    const window = fakeWindow({ x: 40, y: 40, width: 800, height: 600 });
    rememberGeometry(window, (s) => void saved.push(s));

    window.maximized = true;
    window.emit('maximize');
    vi.advanceTimersByTime(1000);

    expect(saved).toEqual([{ bounds: { x: 40, y: 40, width: 800, height: 600 }, maximized: true }]);
  });

  it('leaves a fullscreen window alone: reopening in fullscreen hides the window the user wanted', () => {
    const saved: WindowState[] = [];
    const window = fakeWindow({ x: 40, y: 40, width: 800, height: 600 });
    rememberGeometry(window, (s) => void saved.push(s));

    window.fullScreen = true;
    window.emit('resize');
    vi.advanceTimersByTime(1000);

    expect(saved).toEqual([]);
  });

  it('writes at once when the window closes, without waiting for the debounce', () => {
    const saved: WindowState[] = [];
    const window = fakeWindow({ x: 40, y: 40, width: 800, height: 600 });
    rememberGeometry(window, (s) => void saved.push(s));

    window.emit('move');
    window.emit('close');

    expect(saved).toHaveLength(1);
    // And the debounced write it pre-empted does not land a second time.
    vi.advanceTimersByTime(1000);
    expect(saved).toHaveLength(1);
  });

  it('flushes a pending write on demand, for a quit that closes no window', () => {
    const saved: WindowState[] = [];
    const window = fakeWindow({ x: 40, y: 40, width: 800, height: 600 });
    const tracker = rememberGeometry(window, (s) => void saved.push(s));

    window.emit('move');
    tracker.flush();

    expect(saved).toHaveLength(1);
    // Nothing pending, so a second flush is a no-op rather than a duplicate.
    tracker.flush();
    expect(saved).toHaveLength(1);
  });
});

describe('readWindowState / writeWindowState', () => {
  function tempPath(): string {
    return join(mkdtempSync(join(tmpdir(), 'hexly-window-state-')), 'window-state.json');
  }

  it('round-trips the geometry it wrote', () => {
    const path = tempPath();
    const left = state({ x: 12, y: 34, width: 800, height: 600 }, true);

    writeWindowState(path, left);

    expect(readWindowState(path)).toEqual(left);
  });

  it('creates the folder it writes into', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'hexly-window-state-')), 'nested', 'window-state.json');

    writeWindowState(path, state({ x: 0, y: 0, width: 800, height: 600 }));

    expect(readWindowState(path)).toBeDefined();
  });

  it('reports nothing remembered for a first launch', () => {
    expect(readWindowState(tempPath())).toBeUndefined();
  });

  /** Geometry is a convenience: a corrupt file must never be why the app will not open a window. */
  it('treats an unreadable or wrong-shaped file as nothing remembered', () => {
    for (const contents of ['', 'not json', '{}', '{"bounds":{}}', '{"bounds":{"x":0,"y":0,"width":"wide"}}', '[]']) {
      const path = tempPath();
      writeFileSync(path, contents);

      expect(readWindowState(path)).toBeUndefined();
    }
  });

  it('rejects a window with no area, which no launch could have left', () => {
    const path = tempPath();
    writeFileSync(path, JSON.stringify({ bounds: { x: 0, y: 0, width: 0, height: 600 } }));

    expect(readWindowState(path)).toBeUndefined();
  });
});
