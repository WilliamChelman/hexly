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
 * `electron/index.js` exports the binary's *path* while the package's types describe the in-process API — hence
 * the cast. Passed explicitly because Playwright resolves `electron` from *its* package, which pnpm gives no
 * such dependency.
 */
const electronBinary = createRequire(__filename)('electron') as unknown as string;

/**
 * Which Electron a launch runs and what it runs it on: the repo's own against the unpackaged bundle, or an
 * artifact electron-builder produced that *is* both (#327), so a packaged run waits for the same boot.
 */
export interface LaunchTarget {
  readonly executablePath: string;
  /** Arguments before `--user-data-dir`: the bundle to run, for an Electron that is not itself the app. */
  readonly entryArgs: readonly string[];
  readonly requires: readonly (readonly [path: string, what: string])[];
  /** Shown when a launch dies mid-boot — nearly always a native module built for the wrong ABI. */
  readonly fixHint: string;
}

export const devTarget: LaunchTarget = {
  executablePath: electronBinary,
  entryArgs: [mainJs],
  requires: [
    [mainJs, "the Desktop App's build"],
    [webIndex, "the web app's build"],
  ],
  // One `node_modules` holds one ABI (ADR-0070), and the wrong one kills main mid-boot with no JS error to catch.
  fixHint:
    'If main died loading a native module, run `pnpm native:electron` — and `pnpm native:node` again before `nx test api` or `nx e2e web-e2e`.',
};

/** A launch boots Nest and runs migrations (ADR-0027) before any window exists. */
const BOOT_TIMEOUT = 90_000;

/** A launch the lock refuses exits at once; anything slower has booted something. */
const SECOND_LAUNCH_TIMEOUT = 60_000;

export interface DesktopRun {
  readonly app: ElectronApplication;
  readonly window: Page;
  /** The loopback origin this run bound — an ephemeral port (ADR-0070), so never twice the same. */
  readonly origin: string;
  /** Main's output since Playwright handed the process over, which is *after* `whenReady` — a diagnostic. */
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
 * The suite's base test over one {@link LaunchTarget}: `launch` opens the app against one throwaway Instance
 * Directory per test — call it twice for a relaunch — and quits every run it opened at teardown.
 */
export function defineDesktopTest(target: LaunchTarget) {
  return base.extend<{ userDataDir: string; launch: () => Promise<DesktopRun> }>({
    // Playwright reads a fixture's dependencies off its destructuring pattern; this one has none.
    // eslint-disable-next-line no-empty-pattern
    userDataDir: async ({}, use, testInfo) => {
      // Per test, so no two tests share an Instance Directory — nor the single-instance lock.
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
      // One left open would hold the database — and the lock — into the next test.
      for (const run of runs) await run.close().catch(() => undefined);
    },
  });
}

export const test = defineDesktopTest(devTarget);

export { expect };

/**
 * `MenuItem.click` *is* the handler main gave it, and it is read off the live `Menu` so a spec exercises the
 * menu Electron built rather than the template.
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
 * `--user-data-dir` is the whole isolation: the Instance Directory and the single-instance lock both live under
 * `userData` (ADR-0070), so one switch keeps a developer's real Hexly from answering for the run.
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
    // No process to read output off — a missing native module dies in `failToStart`, behind a modal error box —
    // so the fix-it hint is all this can offer.
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
 * A second launch as double-clicking would do it — not through Playwright, since the behaviour under test is a
 * process that takes the lock's refusal and leaves.
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
