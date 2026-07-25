// First import, and it must stay first: it clears an inherited `NODE_ENV=production` before any API
// module reads that value at its own import time (ADR-0070).
import './no-production-env';
import { join } from 'node:path';
import { app as electron, BrowserWindow, dialog, ipcMain, Menu, screen, session, shell } from 'electron';
import { ApiHost, startApiHost } from './api-host';
import { writeAssetsDir } from './assets-dir';
import { buildContextMenuTemplate } from './context-menu';
import { routeLinks } from './external-links';
import { APP_NAME, pinInstanceDir } from './instance-dir';
import { CANCEL_MOVE_ASSETS, MENU_COMMAND, MOVE_ASSETS, MOVE_ASSETS_PROGRESS, RENEW_SESSION } from './ipc';
import { describeLoopLag, loopLagSettings, startLoopLagProbe, watchRequests } from './loop-lag';
import { buildAppMenuTemplate } from './menu';
import { type AssetStorageMoveOutcome, assetFileStore, moveAssetStorage, throttleProgress } from './move-assets';
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

/** The Asset-storage move in flight, if any: one at a time, and the handle the renderer's Cancel pulls. */
let assetMove: AbortController | undefined;

/** How often progress reaches the renderer — {@link throttleProgress} says why it is throttled at all. */
const PROGRESS_INTERVAL_MS = 100;

/**
 * How long the reply to `MOVE_ASSETS` gets before the relaunch tears the renderer down. Enough for the dialog
 * to say what is about to happen: a window that vanished mid-copy would read as a crash, not as a restart.
 */
const RELAUNCH_DELAY_MS = 600;

/**
 * The tripwire ADR-0070 left itself for the `utilityProcess` decision (#329). Main's loop serves every HTTP
 * response as well as the windows, so "does Nest need to move out of main?" is a question about which
 * handlers hold that loop — and this is what answers it in numbers. Armed here, before anything that can
 * block: the boot migrations are the first long block of a launch.
 */
const lagProbe = startLoopLagProbe(loopLagSettings(process.env), (reading) =>
  console.log(`[hexly] ${describeLoopLag(reading)}`),
);

// Pinned before anything reads `userData`: both the Instance Directory and the single-instance lock hang
// off it, so a later packaged `productName` must not silently move the Instance (ADR-0070).
electron.setName(APP_NAME);

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
  ipcMain.handle(MOVE_ASSETS, moveAssets);
  // `on`, not `handle`: the caller is already awaiting the move, and the abort is what answers it.
  ipcMain.on(CANCEL_MOVE_ASSETS, () => assetMove?.abort());
  electron.whenReady().then(boot).catch(failToStart);
}

/**
 * Everything that has to be true before the window loads: the Instance Directory pinned, the API
 * listening, and the session already in the renderer's jar — so the SPA's first request is authenticated
 * and the login page is never rendered.
 */
async function boot(): Promise<void> {
  // Labelled, because migrations (ADR-0027) are the longest synchronous stretch a launch has, and lag
  // reported with nothing in flight would otherwise be the only trace of them (#329).
  const booting = lagProbe.during('boot');
  try {
    instanceDir = pinInstanceDir(electron.getPath('userData'));
    // Beside `userData`, not inside the Instance Directory: where a window sat is this machine's business, and
    // the Instance Directory is the folder a user copies to back their worldbuilding up (ADR-0070).
    windowStatePath = join(electron.getPath('userData'), 'window-state.json');
    installAppMenu();
    // Session-wide and before any window exists, so every editable surface in every window is covered.
    const languages = enableSpellChecker(session.defaultSession, electron.getLocale());
    console.log(`[hexly] spellchecking ${languages.join(', ') || 'off: no dictionary is available'}`);
    host = await startApiHost();
    watchRequests(host.server, lagProbe);
    await mintSessionCookie(host);
    console.log(`[hexly] hosting ${instanceDir} on ${host.origin}`);
    // Over HTTP from the API we just started, never `file://`, which breaks both the cookie and the
    // single-origin assumption (ADR-0070).
    await openWindow(host.origin);
  } finally {
    booting();
  }
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
 * Move this Instance's Asset bytes to a folder the user picks (#326). Main's half of it is everything the SPA
 * cannot reach: the native picker, the copy, the `hexly.yml` write and the relaunch — while the renderer owns
 * the surface that reports progress and offers Cancel.
 *
 * One at a time. Two copies out of one root would report over each other, and the second would rewrite the
 * config the first is still working towards.
 *
 * A `reason` is English only, as the menu's labels are (ADR-0070): main has no transloco catalog, and most of
 * what lands here is a filesystem message anyway. The renderer supplies the localised sentence above it.
 */
async function moveAssets(event: Electron.IpcMainInvokeEvent): Promise<AssetStorageMoveOutcome> {
  if (assetMove) return { status: 'failed', reason: 'A move of the Asset folder is already running.' };
  if (!host || !instanceDir) return { status: 'failed', reason: 'Hexly is still starting up.' };

  const dir = instanceDir;
  const cancel = new AbortController();
  assetMove = cancel;
  // Gigabytes of hashing and copying is main's own work, so the probe would otherwise attribute the lag it
  // causes to nothing at all (#329).
  const moving = lagProbe.during('move asset storage');
  try {
    const outcome = await moveAssetStorage({
      from: host.assetsDir,
      store: assetFileStore(),
      signal: cancel.signal,
      chooseFolder: () => chooseAssetFolder(BrowserWindow.fromWebContents(event.sender)),
      // Guarded: a window closed mid-copy would otherwise make `send` throw, and a torn-down surface is not
      // a copy failure — the quit that follows a last window closing is what ends this move.
      onProgress: throttleProgress((progress) => {
        if (!event.sender.isDestroyed()) event.sender.send(MOVE_ASSETS_PROGRESS, progress);
      }, PROGRESS_INTERVAL_MS),
      recordNewRoot: (chosen) => writeAssetsDir(dir, chosen),
    });
    // Config is read once at boot (ADR-0036), so applying the new root is a restart — and it is ours to
    // perform rather than something the user has to know to do (ADR-0070).
    if (outcome.status === 'moved') relaunchSoon();
    return outcome;
  } finally {
    assetMove = undefined;
    moving();
  }
}

/** The native folder picker, modal to the window that asked when there is one. */
async function chooseAssetFolder(parent: BrowserWindow | null): Promise<string | undefined> {
  const options: Electron.OpenDialogOptions = {
    title: 'Choose a folder for Hexly’s Assets',
    // `createDirectory` so the user can make the folder here rather than leaving to make it first.
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Move Assets Here',
  };
  const chosen = await (parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options));
  return chosen.canceled ? undefined : chosen.filePaths[0];
}

/**
 * Restart into the new configuration. `quit`, not `exit`: the relaunch has to go through the ordered shutdown
 * that revokes the session and closes the SQLite handle, or the next launch inherits an open database.
 */
function relaunchSoon(): void {
  setTimeout(() => {
    electron.relaunch();
    electron.quit();
  }, RELAUNCH_DELAY_MS);
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
