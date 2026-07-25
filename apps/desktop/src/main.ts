// Must stay first: clears an inherited `NODE_ENV=production` before any API module reads it at import time
// (ADR-0070).
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

/** The main process boots the API in-process on a loopback port and points a window at it (ADR-0070). */
let host: ApiHost | undefined;
let sessionToken: string | undefined;
let instanceDir: string | undefined;
let windowStatePath: string | undefined;
let quitting = false;

const windows = new Set<BrowserWindow>();

/** Where a global gesture lands when the OS reports no focused window — after a menu click on macOS, say. */
let lastFocused: BrowserWindow | undefined;

/** The launch's first window's geometry, the only one remembered — {@link openWindow} says why. */
let geometry: GeometryTracker | undefined;

/** The Asset-storage move in flight: one at a time, and the handle the renderer's Cancel pulls. */
let assetMove: AbortController | undefined;

const PROGRESS_INTERVAL_MS = 100;

/** Long enough for the move's outcome to reach the dialog before the relaunch tears the renderer down. */
const RELAUNCH_DELAY_MS = 600;

// Armed before anything that can block: the boot migrations are a launch's first long block (ADR-0070, #329).
const lagProbe = startLoopLagProbe(loopLagSettings(process.env), (reading) =>
  console.log(`[hexly] ${describeLoopLag(reading)}`),
);

// Before anything reads `userData`: a later packaged `productName` must not silently move the Instance
// (ADR-0070).
electron.setName(APP_NAME);

// Two processes booting migrations over one SQLite file is a race (ADR-0027).
if (!electron.requestSingleInstanceLock()) {
  // `exit`, not `quit`: nothing is hosted yet to shut down in order.
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
 * Everything that has to be true before the window loads — the session is in the renderer's jar first, so the
 * login page is never rendered (ADR-0070).
 */
async function boot(): Promise<void> {
  // Labelled so a launch's lag is attributable to the boot migrations (#329).
  const booting = lagProbe.during('boot');
  try {
    instanceDir = pinInstanceDir(electron.getPath('userData'));
    // Beside `userData`, not in the Instance Directory: geometry is this machine's business, not part of the
    // folder a user copies to back their worldbuilding up (ADR-0070).
    windowStatePath = join(electron.getPath('userData'), 'window-state.json');
    installAppMenu();
    // Session-wide and before any window exists, so every editable surface in every window is covered.
    const languages = enableSpellChecker(session.defaultSession, electron.getLocale());
    console.log(`[hexly] spellchecking ${languages.join(', ') || 'off: no dictionary is available'}`);
    host = await startApiHost();
    watchRequests(host.server, lagProbe);
    await mintSessionCookie(host);
    console.log(`[hexly] hosting ${instanceDir} on ${host.origin}`);
    // Over HTTP, never `file://`: that breaks both the cookie and the single-origin assumption (ADR-0070).
    await openWindow(host.origin);
  } finally {
    booting();
  }
}

async function mintSessionCookie(api: ApiHost): Promise<void> {
  sessionToken = await openSoleUserSession(api.auth);
  await writeSessionCookie(session.defaultSession.cookies, api.origin, sessionToken);
}

/**
 * A Command item sends its id to the renderer, which invokes the Command the Palette lists — a second surface,
 * not a second dispatcher (ADR-0070).
 */
function installAppMenu(): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildAppMenuTemplate(process.platform, {
        // The focused window: the menu is global to the app, so a Command means "here", where the user is.
        invokeCommand: (commandId) => activeWindow()?.webContents.send(MENU_COMMAND, commandId),
        openNewWindow: () => void (host && openWindow(host.origin).catch(reportWindowFailure)),
        // Nothing to reveal before the Instance Directory is pinned, which `boot` does first.
        revealDataFolder: () => void (instanceDir && revealFolder(shell, instanceDir)),
      }),
    ),
  );
}

/**
 * Only the launch's first window restores and remembers geometry; the rest cascade off it (ADR-0070), since
 * persisting a cascade would walk the remembered position a step down the screen each time.
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
      // Electron's defaults, restated: nothing in the renderer should reach Node (ADR-0070).
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
    // Even on failure: an invisible window is a phantom in the window list.
    if (!window.isDestroyed()) window.show();
  }
  return window;
}

function placement(first: boolean): WindowPlacement {
  const workAreas = screen.getAllDisplays().map((display) => display.workArea);
  const openedFrom = activeWindow();
  if (first || !openedFrom)
    return restoredPlacement(windowStatePath ? readWindowState(windowStatePath) : undefined, workAreas);
  return cascadedFrom(openedFrom.getNormalBounds(), workAreas);
}

/**
 * Electron ships no default context menu at all, so this is where the spellchecker's suggestions live
 * (ADR-0070).
 */
function installContextMenu(window: BrowserWindow): void {
  window.webContents.on('context-menu', (_event, params) => {
    const template = buildContextMenuTemplate(params, {
      replaceMisspelling: (word) => window.webContents.replaceMisspelling(word),
      // On the session, so a taught word is known in every window and every launch after this one.
      addToDictionary: (word) => void session.defaultSession.addWordToSpellCheckerDictionary(word),
    });
    if (template.length) Menu.buildFromTemplate(template).popup({ window });
  });
}

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

/** Re-mint after a 401: the login page is a dead end in this profile, so a 401 is recoverable (ADR-0070). */
async function renewSession(): Promise<void> {
  if (!host) return;
  await mintSessionCookie(host);
}

/**
 * Move this Instance's Asset bytes to a folder the user picks (#326): main owns the picker, the copy, the
 * `hexly.yml` write and the relaunch; the renderer owns progress and Cancel. One at a time, since a second copy
 * would rewrite the config the first is still working towards. A `reason` is English only, as the menu's labels
 * are (ADR-0070); the renderer supplies the localised sentence above it.
 */
async function moveAssets(event: Electron.IpcMainInvokeEvent): Promise<AssetStorageMoveOutcome> {
  if (assetMove) return { status: 'failed', reason: 'A move of the Asset folder is already running.' };
  if (!host || !instanceDir) return { status: 'failed', reason: 'Hexly is still starting up.' };

  const dir = instanceDir;
  const cancel = new AbortController();
  assetMove = cancel;
  // Main's own work rather than a request, so the probe has something to attribute its lag to (#329).
  const moving = lagProbe.during('move asset storage');
  try {
    const outcome = await moveAssetStorage({
      from: host.assetsDir,
      store: assetFileStore(),
      signal: cancel.signal,
      chooseFolder: () => chooseAssetFolder(BrowserWindow.fromWebContents(event.sender)),
      // Guarded: a window closed mid-copy would make `send` throw, and a torn-down surface is not a copy failure.
      onProgress: throttleProgress((progress) => {
        if (!event.sender.isDestroyed()) event.sender.send(MOVE_ASSETS_PROGRESS, progress);
      }, PROGRESS_INTERVAL_MS),
      recordNewRoot: (chosen) => writeAssetsDir(dir, chosen),
    });
    // Config is read once at boot (ADR-0036), so applying the new root means a restart we own (ADR-0070).
    if (outcome.status === 'moved') relaunchSoon();
    return outcome;
  } finally {
    assetMove = undefined;
    moving();
  }
}

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
 * `quit`, not `exit`: the relaunch has to go through the ordered shutdown that closes the SQLite handle, or the
 * next launch inherits an open database.
 */
function relaunchSoon(): void {
  setTimeout(() => {
    electron.relaunch();
    electron.quit();
  }, RELAUNCH_DELAY_MS);
}

/**
 * Quit is ordered (ADR-0070): revoke the session, close the SQLite handle, then exit. Both are async, so the
 * quit is deferred and re-issued as an explicit exit; the latch keeps a second ⌘Q from racing the first.
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
 * No in-app surface exists yet, so a boot failure goes to the platform's error box — still shutting down in
 * order, since a failure after `listen` leaves the database open and `exit` alone skips `before-quit`.
 */
async function failToStart(err: unknown): Promise<void> {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error('[hexly] failed to start', detail);
  quitting = true;
  await shutDown().catch((closeErr) => console.error('[hexly] unclean shutdown', closeErr));
  dialog.showErrorBox('Hexly could not start', detail);
  electron.exit(1);
}
