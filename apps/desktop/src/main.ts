// First import, and it must stay first: it clears an inherited `NODE_ENV=production` before any API
// module reads that value at its own import time (ADR-0070).
import './no-production-env';
import { join } from 'node:path';
import { app as electron, BrowserWindow, dialog, ipcMain, Menu, screen, session, shell } from 'electron';
import { ApiHost, startApiHost } from './api-host';
import { buildContextMenuTemplate } from './context-menu';
import { routeLinks } from './external-links';
import { pinInstanceDir } from './instance-dir';
import { MENU_COMMAND, RENEW_SESSION } from './ipc';
import { buildAppMenuTemplate } from './menu';
import { revealFolder } from './reveal-folder';
import { writeSessionCookie } from './session-cookie';
import { closeSoleUserSession, openSoleUserSession } from './sole-user';
import { enableSpellChecker } from './spellcheck';
import {
  cascadedFrom,
  type GeometryTracker,
  readWindowState,
  rememberGeometry,
  restoredPlacement,
  type WindowPlacement,
  writeWindowState,
} from './window-state';

/**
 * The Desktop App's main process: it boots the API in-process on a loopback port and points a window at
 * it, leaving ADR-0008's one-process-one-origin topology alone (ADR-0070). The shell owns launch,
 * identity, windows and shutdown, and nothing else.
 */
let host: ApiHost | undefined;
let sessionToken: string | undefined;
let instanceDir: string | undefined;
let windowStatePath: string | undefined;
let quitting = false;

/**
 * Every window this launch has open. Multiple windows are coherent precisely because live-follow was kept
 * (ADR-0044): two windows on one Entity reconcile through the nudge bus, so the user's own windows never
 * disagree.
 */
const windows = new Set<BrowserWindow>();

/** Where a global gesture lands when the OS reports no focused window — after a menu click on macOS, say. */
let lastFocused: BrowserWindow | undefined;

/** The geometry of the launch's first window, which is the only one remembered — {@link openWindow} says why. */
let geometry: GeometryTracker | undefined;

// Pinned before anything reads `userData`: both the Instance Directory and the single-instance lock hang
// off it, so a later packaged `productName` must not silently move the Instance (ADR-0070).
electron.setName('Hexly');

// A single-instance lock: two processes booting migrations over one SQLite file is a race (ADR-0027).
if (!electron.requestSingleInstanceLock()) {
  // `exit`, not `quit`: nothing is hosted yet, so there is nothing to shut down in order.
  electron.exit(0);
} else {
  electron.on('second-instance', focusWindow);
  // Lingering with no window would hold the database open for nothing.
  electron.on('window-all-closed', () => electron.quit());
  electron.on('before-quit', beginQuit);
  ipcMain.handle(RENEW_SESSION, renewSession);
  electron.whenReady().then(boot).catch(failToStart);
}

/**
 * Everything that has to be true before the window loads: the Instance Directory pinned, the API
 * listening, and the session already in the renderer's jar — so the SPA's first request is authenticated
 * and the login page is never rendered.
 */
async function boot(): Promise<void> {
  instanceDir = pinInstanceDir(electron.getPath('userData'));
  // Beside `userData`, not inside the Instance Directory: where a window sat is this machine's business, and
  // the Instance Directory is the folder a user copies to back their worldbuilding up (ADR-0070).
  windowStatePath = join(electron.getPath('userData'), 'window-state.json');
  installAppMenu();
  // Session-wide and before any window exists, so every editable surface in every window is covered.
  const languages = enableSpellChecker(session.defaultSession, electron.getLocale());
  console.log(`[hexly] spellchecking ${languages.join(', ') || 'off: no dictionary is available'}`);
  host = await startApiHost();
  await mintSessionCookie(host);
  console.log(`[hexly] hosting ${instanceDir} on ${host.origin}`);
  // Over HTTP from the API we just started, never `file://`, which breaks both the cookie and the
  // single-origin assumption (ADR-0070).
  await openWindow(host.origin);
}

/** Open the Sole User's session and put it where the renderer will send it. */
async function mintSessionCookie(api: ApiHost): Promise<void> {
  sessionToken = await openSoleUserSession(api.auth);
  await writeSessionCookie(session.defaultSession.cookies, api.origin, sessionToken);
}

/**
 * The application menu, installed once and global to the app. A Command item sends its id to the renderer,
 * which invokes the Command the Palette lists — a second surface, not a second dispatcher (ADR-0070).
 */
function installAppMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildAppMenuTemplate(process.platform, {
        // The focused window: the menu is global to the app, so a Command means "here", where the user is.
        invokeCommand: (commandId) => activeWindow()?.webContents.send(MENU_COMMAND, commandId),
        // A second window on the same Instance, on the World Index — where a launch opens too.
        openNewWindow: () => void (host && openWindow(host.origin).catch(reportWindowFailure)),
        // Nothing to reveal before the Instance Directory is pinned, which `boot` does first.
        revealDataFolder: () => void (instanceDir && revealFolder(shell, instanceDir)),
      }),
    ),
  );
}

/**
 * Open a window on `url` and resolve once it has loaded.
 *
 * The launch's **first** window reopens at the geometry the last launch was left at, and is the only one whose
 * geometry is remembered (ADR-0070): the rest cascade off it, and persisting a cascade would walk the
 * remembered position a step down the screen for every second window ever opened.
 */
async function openWindow(url: string): Promise<BrowserWindow> {
  const first = windows.size === 0;
  const { maximized, ...bounds } = placement(first);
  const window = new BrowserWindow({
    ...bounds,
    title: 'Hexly',
    // Shown once it has something to paint, so a restored maximize is not a visible snap from the default size.
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      // Electron's defaults, restated: the renderer runs the same SPA a browser runs, nothing in it should
      // reach Node, and the app is a prose tool so the spellchecker stays on (ADR-0070).
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  if (maximized) window.maximize();

  windows.add(window);
  if (first)
    geometry = rememberGeometry(window, (state) => windowStatePath && writeWindowState(windowStatePath, state));
  window.on('focus', () => void (lastFocused = window));
  window.on('closed', () => {
    windows.delete(window);
    if (lastFocused === window) lastFocused = undefined;
    // Nothing to flush from a window that is gone, and `getNormalBounds` on a destroyed one throws.
    if (first) geometry = undefined;
  });
  installContextMenu(window);
  routeLinks(window.webContents, new URL(url).origin, shell, {
    openWindow: (internalUrl) => void openWindow(internalUrl).catch(reportWindowFailure),
  });

  try {
    await window.loadURL(url);
  } finally {
    // Even on a failure: an invisible window is a phantom in the window list with nothing to report itself on.
    if (!window.isDestroyed()) window.show();
  }
  return window;
}

/** Where the next window opens: remembered for the launch's first, cascaded off the active one for the rest. */
function placement(first: boolean): WindowPlacement {
  const workAreas = screen.getAllDisplays().map((display) => display.workArea);
  const openedFrom = activeWindow();
  if (first || !openedFrom)
    return restoredPlacement(windowStatePath ? readWindowState(windowStatePath) : undefined, workAreas);
  return cascadedFrom(openedFrom.getNormalBounds(), workAreas);
}

/**
 * The right-click menu, per window. Electron ships no default context menu at all, so this is where the
 * spellchecker's suggestions live — and without them the underlining is only half a spellchecker (ADR-0070).
 */
function installContextMenu(window: BrowserWindow): void {
  window.webContents.on('context-menu', (_event, params) => {
    const template = buildContextMenuTemplate(params, {
      replaceMisspelling: (word) => window.webContents.replaceMisspelling(word),
      // On the session, so a name the user taught it is known in every window and every launch after this one.
      addToDictionary: (word) => void session.defaultSession.addWordToSpellCheckerDictionary(word),
    });
    if (template.length) Menu.buildFromTemplate(template).popup({ window });
  });
}

/** The window a global gesture means: the one the OS says is focused, else the last one that was. */
function activeWindow(): BrowserWindow | undefined {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && windows.has(focused)) return focused;
  if (lastFocused && windows.has(lastFocused)) return lastFocused;
  return [...windows.keys()].at(-1);
}

/** A second launch means "show me the Instance I have open", not "open it twice". */
function focusWindow(): void {
  const window = activeWindow();
  if (!window) return;
  if (window.isMinimized()) window.restore();
  window.focus();
}

/** A window that would not load has no in-app surface of its own; the one the user has keeps working. */
function reportWindowFailure(err: unknown): void {
  console.error('[hexly] could not open a window', err);
}

/**
 * Re-mint after a 401. Recoverable because identity is never in question here, and necessary because the
 * login page is a dead end in this profile (ADR-0070); the renderer asks over the preload bridge and
 * retries its navigation (#321).
 */
async function renewSession(): Promise<void> {
  if (!host) return;
  await mintSessionCookie(host);
}

/**
 * Quit is ordered (ADR-0070): revoke the session, let the shutdown hooks close the SQLite handle, then
 * exit. Both are async, so the quit is deferred and re-issued as an explicit exit; the `quitting` latch
 * keeps a second Cmd-Q from racing the first.
 */
function beginQuit(event: Electron.Event): void {
  if (quitting) return;
  quitting = true;
  // Before anything else: this path ends in `exit`, which emits no window `close`.
  geometry?.flush();
  event.preventDefault();
  shutDown().then(
    () => electron.exit(0),
    (err) => {
      console.error('[hexly] unclean shutdown', err);
      electron.exit(1);
    },
  );
}

async function shutDown(): Promise<void> {
  if (host && sessionToken) await closeSoleUserSession(host.auth, sessionToken);
  await host?.close();
}

/**
 * A boot failure has no in-app surface to report itself on, so it goes to the platform's error box. It
 * still shuts down in order: a failure after `listen` leaves the database open and a session minted, and
 * `exit` alone would skip `before-quit`.
 */
async function failToStart(err: unknown): Promise<void> {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error('[hexly] failed to start', detail);
  quitting = true;
  await shutDown().catch((closeErr) => console.error('[hexly] unclean shutdown', closeErr));
  dialog.showErrorBox('Hexly could not start', detail);
  electron.exit(1);
}
