import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { _electron, expect, type ElectronApplication, type Page, test as base } from '@playwright/test';

// `__dirname` (not `import.meta`) because Playwright loads this suite as CommonJS.
export const workspaceRoot = join(__dirname, '..', '..', '..');
const mainJs = join(workspaceRoot, 'dist', 'apps', 'desktop', 'main.js');
// The shell's own API serves the SPA (ADR-0008), so a missing web build opens a window onto nothing.
const webIndex = join(workspaceRoot, 'dist', 'apps', 'web', 'browser', 'index.html');

/**
 * The platform's Electron binary: `electron/index.js` exports its *path*, while the package's types
 * describe the in-process API — hence the cast. Passed explicitly because Playwright's own lookup resolves
 * `electron` from *its* package, which pnpm gives no such dependency.
 */
const electronBinary = createRequire(__filename)('electron') as unknown as string;

/**
 * Which Electron a launch runs, and what it runs it on: the repo's own `electron` against the unpackaged
 * bundle, or an artifact electron-builder produced that *is* both (#327). Everything past `_electron.launch`
 * is the same either way, which is the point — the packaged smoke check waits for the same boot this suite
 * already knows how to wait for, rather than reimplementing it beside a build step.
 */
export interface LaunchTarget {
  readonly executablePath: string;
  /** Arguments before `--user-data-dir`: the bundle to run, for an Electron that is not itself the app. */
  readonly entryArgs: readonly string[];
  /** What must exist before a launch is worth attempting, as path → what a missing one is. */
  readonly requires: readonly (readonly [path: string, what: string])[];
  /** What to try when a launch dies mid-boot — nearly always a native module built for the wrong ABI. */
  readonly fixHint: string;
}

/** The unpackaged bundle, run by the Electron in `node_modules` — what `nx e2e desktop-e2e` launches. */
export const devTarget: LaunchTarget = {
  executablePath: electronBinary,
  entryArgs: [mainJs],
  requires: [
    [mainJs, "the Desktop App's build"],
    [webIndex, "the web app's build"],
  ],
  // One node_modules holds one ABI (ADR-0070), and a `better-sqlite3` built for Node's — or one left
  // linker-signed on macOS — kills main mid-boot with no JS error to catch.
  fixHint:
    'If main died loading a native module, run `pnpm native:electron` — and `pnpm native:node` again before `nx test api` or `nx e2e web-e2e`.',
};

/** A launch boots Nest and runs migrations (ADR-0027) before any window exists. */
const BOOT_TIMEOUT = 90_000;

/** A launch the lock refuses exits at once; anything slower has booted something. */
const SECOND_LAUNCH_TIMEOUT = 60_000;

/** One launched Desktop App. */
export interface DesktopRun {
  readonly app: ElectronApplication;
  /** The window the shell opened, loaded at {@link origin}. */
  readonly window: Page;
  /** The loopback origin this run bound — an ephemeral port (ADR-0070), so never twice the same. */
  readonly origin: string;
  /**
   * Everything main has written since Playwright handed the process over, which is *after* `whenReady` — so an
   * early `boot` line can be missing, and this is a diagnostic rather than something to assert against.
   */
  output(): string;
  /** Quit as the user does: the ordered shutdown revokes the session and closes the SQLite handle. */
  close(): Promise<void>;
}

/** What a second launch did, seen from outside — the only view a double-click gives. */
export interface SecondLaunch {
  readonly exitCode: number | null;
  readonly output: string;
}

/**
 * The Electron suite's base test, over one {@link LaunchTarget}. `launch` opens the Desktop App against one
 * throwaway Instance Directory per test — call it twice for a relaunch — and quits every run it opened at
 * teardown.
 */
export function defineDesktopTest(target: LaunchTarget) {
  return base.extend<{ userDataDir: string; launch: () => Promise<DesktopRun> }>({
    // Playwright reads a fixture's dependencies off its destructuring pattern; this one has none.
    // eslint-disable-next-line no-empty-pattern
    userDataDir: async ({}, use, testInfo) => {
      // Per test, so no two tests share an Instance Directory — nor the single-instance lock, which is what
      // lets the relaunch and second-launch facts sit in one suite.
      const dir = join(workspaceRoot, 'tmp', 'desktop-e2e', testInfo.testId);
      // Cleared going in, not coming out: a failed run's database is the first thing worth looking at.
      rmSync(dir, { recursive: true, force: true });
      await use(dir);
    },

    launch: async ({ userDataDir }, use) => {
      const runs: DesktopRun[] = [];
      await use(async () => {
        const run = await launchDesktopApp(userDataDir, target);
        runs.push(run);
        return run;
      });
      // A run the test already quit is a no-op here; one left open would hold the database — and the lock —
      // into the next test.
      for (const run of runs) await run.close().catch(() => undefined);
    },
  });
}

/** The suite's own test: the unpackaged bundle. A packaged run defines its own from {@link defineDesktopTest}. */
export const test = defineDesktopTest(devTarget);

export { expect };

/**
 * Choose an application-menu item the way a user does: `MenuItem.click` *is* the handler main gave it, so
 * calling it is the click. Read off the live `Menu`, so a spec exercises the menu Electron built rather than
 * the template it was built from.
 */
export function clickMenuItem(app: ElectronApplication, id: string): Promise<void> {
  return app.evaluate(({ Menu }, itemId) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById(itemId);
    if (!item) throw new Error(`No menu item with id "${itemId}"`);
    // Electron types `click` as the handler it will be called with; ours reads none of its arguments.
    (item.click as unknown as () => void)();
  }, id);
}

/**
 * Launch the Desktop App against `userDataDir`, resolving once its window is loaded at the API's origin.
 *
 * `--user-data-dir` is the whole isolation: the Instance Directory is pinned to `userData/hexly` and the
 * single-instance lock lives there too (ADR-0070), so that one switch gives the run its own database and
 * keeps a developer's real Hexly from answering for it.
 */
async function launchDesktopApp(userDataDir: string, target: LaunchTarget): Promise<DesktopRun> {
  for (const [path, what] of target.requires) requireBuilt(path, what);

  let app: ElectronApplication;
  try {
    app = await _electron.launch({
      executablePath: target.executablePath,
      args: launchArgs(userDataDir, target),
      cwd: workspaceRoot,
      timeout: BOOT_TIMEOUT,
    });
  } catch (err) {
    // A launch Playwright never gets a handle on, which is the shape a missing native module takes: main dies
    // in `failToStart`, whose modal error box answers nothing. There is no process to read output off, so the
    // fix-it hint is all this can offer — and it is the answer nearly every time.
    throw new Error(bootFailureMessage(err, '', target));
  }
  const output = collectOutput(app.process());

  try {
    const window = await app.firstWindow({ timeout: BOOT_TIMEOUT });
    // Main loads the window at the port it just bound, so this is also how the suite learns that port.
    await window.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: BOOT_TIMEOUT });
    return { app, window, origin: new URL(window.url()).origin, output, close: () => app.close() };
  } catch (err) {
    // Not `close()`: a boot failure puts up a modal error box, which will never answer a quit.
    app.process().kill('SIGKILL');
    throw new Error(bootFailureMessage(err, output(), target));
  }
}

/**
 * Launch the app a second time the way double-clicking it would. Not driven through Playwright: the
 * behaviour under test is a process that takes the lock's refusal and leaves.
 */
export async function launchAgain(userDataDir: string): Promise<SecondLaunch> {
  const child = spawn(devTarget.executablePath, launchArgs(userDataDir, devTarget), { cwd: workspaceRoot });
  const output = collectOutput(child);

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const stillRunning = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`The second launch was still running after ${SECOND_LAUNCH_TIMEOUT}ms:\n${output()}`));
    }, SECOND_LAUNCH_TIMEOUT);
    child.once('exit', (code) => (clearTimeout(stillRunning), resolve(code)));
    child.once('error', (err) => (clearTimeout(stillRunning), reject(err)));
  });
  return { exitCode, output: output() };
}

function launchArgs(userDataDir: string, target: LaunchTarget): string[] {
  return [...target.entryArgs, `--user-data-dir=${userDataDir}`];
}

/** Whatever a main process wrote, so a launch that opens no window can still say why. */
function collectOutput(main: ChildProcess): () => string {
  let output = '';
  main.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  main.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  return () => output;
}

/** Fail with a fix-it hint rather than a bare timeout, as `e2e-server.mjs` does for the browser suite. */
function requireBuilt(path: string, what: string): void {
  if (existsSync(path)) return;
  throw new Error(
    `Missing ${what} (${path}). Build first: \`nx run-many -t build -p desktop web\`, or run via \`nx e2e desktop-e2e\`.`,
  );
}

function bootFailureMessage(err: unknown, mainOutput: string, target: LaunchTarget): string {
  return [
    `The Desktop App opened no window: ${err instanceof Error ? err.message : String(err)}`,
    target.fixHint,
    mainOutput && `--- the main process said ---\n${mainOutput}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}
