import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** A window's rectangle in screen coordinates, as Electron reports and takes it. */
export interface WindowBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The geometry a launch remembers from the last one. */
export interface WindowState {
  /** The un-maximized rectangle, so restoring an un-maximize lands somewhere sensible. */
  readonly bounds: WindowBounds;
  readonly maximized: boolean;
}

/** `BrowserWindow` options describing where a window should open. */
export interface WindowPlacement {
  readonly width: number;
  readonly height: number;
  /** Absent means "let the platform centre it" — a first launch, or geometry that no longer fits a screen. */
  readonly x?: number;
  readonly y?: number;
  readonly maximized: boolean;
}

/** A first launch's window: large enough for the reading column beside a surface. */
export const DEFAULT_WINDOW_SIZE = { width: 1440, height: 900 } as const;

/**
 * How much of a restored window has to land on a screen for the geometry to be worth restoring. Enough that
 * the title bar can be grabbed — a window restored fully off-screen cannot be dragged back.
 */
const MIN_VISIBLE_EDGE = 64;

/** How far a second window sits from the one it was opened from, so the two do not read as one. */
const CASCADE_OFFSET = 32;

/** Coalesce a resize drag into one write; short enough that a quit right after a drag still catches it. */
const SAVE_DEBOUNCE_MS = 400;

/**
 * Where the first window of a launch opens: the geometry it was left at (ADR-0070), unless that no longer
 * lands on a screen the user has — a laptop undocked from the external monitor it was maximized on would
 * otherwise reopen off-screen, with no way to drag it back.
 */
export function restoredPlacement(saved: WindowState | undefined, workAreas: readonly WindowBounds[]): WindowPlacement {
  if (!saved || !isReachable(saved.bounds, workAreas)) return { ...DEFAULT_WINDOW_SIZE, maximized: false };
  return { ...saved.bounds, maximized: saved.maximized };
}

/**
 * Where a *second* window opens: offset from the window it was opened from, since two windows exactly on top of
 * each other look like one. Up and to the left when down and to the right would run off the screen — not
 * centred, which for an already-centred opener lands the new window exactly where cascading avoids.
 */
export function cascadedFrom(from: WindowBounds, workAreas: readonly WindowBounds[]): WindowPlacement {
  for (const step of [CASCADE_OFFSET, -CASCADE_OFFSET]) {
    const offset = { ...from, x: from.x + step, y: from.y + step };
    if (fitsWithin(offset, workAreas)) return { ...offset, maximized: false };
  }
  // Neither direction fits, so the opener already fills its screen and any second window overlaps it anyway.
  return { width: from.width, height: from.height, maximized: false };
}

/** Whether enough of `bounds` overlaps a screen that the user could still grab the window. */
function isReachable(bounds: WindowBounds, workAreas: readonly WindowBounds[]): boolean {
  return workAreas.some(
    (area) =>
      overlap(bounds.x, bounds.width, area.x, area.width) >= MIN_VISIBLE_EDGE &&
      overlap(bounds.y, bounds.height, area.y, area.height) >= MIN_VISIBLE_EDGE,
  );
}

/** Whether `bounds` sits wholly inside one screen. */
function fitsWithin(bounds: WindowBounds, workAreas: readonly WindowBounds[]): boolean {
  return workAreas.some(
    (area) =>
      bounds.x >= area.x &&
      bounds.y >= area.y &&
      bounds.x + bounds.width <= area.x + area.width &&
      bounds.y + bounds.height <= area.y + area.height,
  );
}

function overlap(start: number, length: number, otherStart: number, otherLength: number): number {
  return Math.min(start + length, otherStart + otherLength) - Math.max(start, otherStart);
}

/** As much of a `BrowserWindow` as remembering its geometry needs, so a spec can stand in for one. */
export interface GeometryWindow {
  /** The rectangle the window has when not maximized — what a restore should use. */
  getNormalBounds(): WindowBounds;
  isMaximized(): boolean;
  isFullScreen(): boolean;
  on(event: 'resize' | 'move' | 'maximize' | 'unmaximize' | 'close', listener: () => void): unknown;
}

export interface GeometryTracker {
  /**
   * Write a pending change now. The ordered quit ends in `app.exit` (ADR-0070), which tears the windows down
   * without emitting `close`, so nothing else would flush the last drag of a session.
   */
  flush(): void;
}

/**
 * Remember `window`'s geometry as the user moves it, so the next launch reopens where this one was left
 * (ADR-0070). Writes are debounced: a resize drag emits an event per frame, and the state is only ever read
 * once, at boot.
 *
 * Fullscreen is deliberately not persisted — reopening in fullscreen hides the window the user was looking
 * for — so a window in it is left alone until it comes back out.
 */
export function rememberGeometry(window: GeometryWindow, persist: (state: WindowState) => void): GeometryTracker {
  let pending: ReturnType<typeof setTimeout> | undefined;

  const write = (): void => {
    pending = undefined;
    if (window.isFullScreen()) return;
    persist({ bounds: window.getNormalBounds(), maximized: window.isMaximized() });
  };
  const schedule = (): void => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(write, SAVE_DEBOUNCE_MS);
  };

  for (const event of ['resize', 'move', 'maximize', 'unmaximize'] as const) window.on(event, schedule);
  // A closed window writes at once: it is about to stop emitting anything.
  window.on('close', () => (pending && clearTimeout(pending), write()));

  return {
    flush: () => void (pending && (clearTimeout(pending), write())),
  };
}

/**
 * The geometry a previous launch left, or `undefined` if there is none to trust. Anything unreadable,
 * unparseable or the wrong shape is treated as absent: window position is a convenience, and a corrupt file
 * must never be the reason the app will not start.
 */
export function readWindowState(path: string): WindowState | undefined {
  try {
    return asWindowState(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    return undefined;
  }
}

/** Persist `state`. A failure is reported rather than thrown, for the same reason a read is forgiving. */
export function writeWindowState(path: string, state: WindowState): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state));
  } catch (err) {
    console.error(`[hexly] could not save the window geometry to ${path}`, err);
  }
}

function asWindowState(parsed: unknown): WindowState | undefined {
  const candidate = parsed as { bounds?: Record<string, unknown>; maximized?: unknown } | null;
  const bounds = candidate?.bounds;
  if (!bounds) return undefined;
  const numbers = (['x', 'y', 'width', 'height'] as const).map((key) => bounds[key]);
  if (!numbers.every((value) => typeof value === 'number' && Number.isFinite(value))) return undefined;
  const [x, y, width, height] = numbers as number[];
  // A zero-sized window is unusable and a negative one is nonsense; either says the file is not ours.
  if (width <= 0 || height <= 0) return undefined;
  return { bounds: { x, y, width, height }, maximized: candidate?.maximized === true };
}
