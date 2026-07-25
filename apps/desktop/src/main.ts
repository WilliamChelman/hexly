// First import, and it must stay first: it clears an inherited `NODE_ENV=production` before any API
// module reads that value at its own import time (ADR-0070).
import './no-production-env';
import { join } from 'node:path';
import { app as electron, BrowserWindow, dialog, ipcMain, Menu, session, shell } from 'electron';
import { ApiHost, startApiHost } from './api-host';
import { pinInstanceDir } from './instance-dir';
import { MENU_COMMAND, RENEW_SESSION } from './ipc';
import { buildAppMenuTemplate } from './menu';
import { revealFolder } from './reveal-folder';
import { writeSessionCookie } from './session-cookie';
import { closeSoleUserSession, openSoleUserSession } from './sole-user';

/**
 * The Desktop App's main process: it boots the API in-process on a loopback port and points a window at
 * it, leaving ADR-0008's one-process-one-origin topology alone (ADR-0070). The shell owns launch,
 * identity and shutdown, and nothing else.
 */
let host: ApiHost | undefined;
let sessionToken: string | undefined;
let mainWindow: BrowserWindow | undefined;
let instanceDir: string | undefined;
let quitting = false;

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
  installAppMenu();
  host = await startApiHost();
  await mintSessionCookie(host);
  mainWindow = openWindow();
  console.log(`[hexly] hosting ${instanceDir} on ${host.origin}`);
  // Over HTTP from the API we just started, never `file://`, which breaks both the cookie and the
  // single-origin assumption (ADR-0070).
  await mainWindow.loadURL(host.origin);
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
        // `mainWindow` while there is one window; multi-window (ADR-0070) makes this the focused one.
        invokeCommand: (commandId) => mainWindow?.webContents.send(MENU_COMMAND, commandId),
        // Nothing to reveal before the Instance Directory is pinned, which `boot` does first.
        revealDataFolder: () => void (instanceDir && revealFolder(shell, instanceDir)),
      }),
    ),
  );
}

function openWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'Hexly',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      // Electron's defaults, restated: the renderer runs the same SPA a browser runs, and nothing in it
      // should reach Node (ADR-0070).
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.on('closed', () => (mainWindow = undefined));
  return window;
}

/** A second launch means "show me the Instance I have open", not "open it twice". */
function focusWindow(): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
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
