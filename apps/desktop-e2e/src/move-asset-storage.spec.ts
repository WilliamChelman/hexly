import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { parse } from 'yaml';
import { clickMenuItem, expect, test } from './desktop-app';

/** Restated because main and the SPA are two bundles, and this suite drives the shell's one. */
const MOVE_ASSET_STORAGE = 'move-asset-storage';

/** A World's folder and a content-addressed pair inside it, as an upload would leave them (ADR-0034). */
const WORLD = 'w-seeded';
const ORIGINAL = 'abc123.png';
const THUMBNAIL = 'abc123.thumb.webp';
const BYTES = 'not really a png, but bytes are bytes';

/** What the stubbed `app.relaunch` writes, so the restart can be read off main's output. */
const RELAUNCH_LINE = '[spec] relaunch requested';

/**
 * Stands in for the native picker, which no runner can drive, and for the respawn only — a self-relaunching
 * process detaches from Playwright and takes the single-instance lock with it. `app.quit` is left alone: the
 * ordered quit that follows the relaunch is part of what is under test.
 */
async function standInForPickerAndRespawn(app: ElectronApplication, chosen: string): Promise<void> {
  await app.evaluate(
    ({ app: electron, dialog }, [dir, line]) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as typeof dialog.showOpenDialog;
      electron.relaunch = () => void console.log(line);
    },
    [chosen, RELAUNCH_LINE],
  );
}

function seedAssets(instanceDir: string): string {
  const root = join(instanceDir, 'assets', WORLD);
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, ORIGINAL), BYTES);
  // A sibling of the original, since a move that dropped it would leave every tile blank.
  writeFileSync(join(root, THUMBNAIL), `thumbnail of ${BYTES}`);
  return root;
}

/** The Desktop App moves Asset storage for you (#326); everything but the respawn is real here. */
test('the menu moves the Asset bytes to a chosen folder and serves them from it next launch', async ({
  launch,
  userDataDir,
}) => {
  const instanceDir = join(userDataDir, 'hexly');
  const chosen = join(userDataDir, 'chosen-assets');

  const first = await launch();
  await first.window.waitForURL(/\/worlds$/);
  const oldRoot = seedAssets(instanceDir);
  await standInForPickerAndRespawn(first.app, chosen);

  await clickMenuItem(first.app, MOVE_ASSET_STORAGE);

  // Config is read once at boot (ADR-0070), so the app going away *is* the success signal — and waiting for it
  // makes the rest race-free.
  await first.app.waitForEvent('close');
  expect(first.output()).toContain(RELAUNCH_LINE);

  expect(readFileSync(join(chosen, WORLD, ORIGINAL), 'utf8')).toBe(BYTES);
  expect(readFileSync(join(chosen, WORLD, THUMBNAIL), 'utf8')).toBe(`thumbnail of ${BYTES}`);
  // The originals stay, so a move that went wrong is recoverable by hand.
  expect(readFileSync(join(oldRoot, ORIGINAL), 'utf8')).toBe(BYTES);
  // The one key #324 reads the root from.
  expect(parse(readFileSync(join(instanceDir, 'hexly.yml'), 'utf8')).assets.dir).toBe(chosen);

  // Deleted before the relaunch, so the next launch can only be reading the folder that was chosen.
  rmSync(oldRoot, { recursive: true, force: true });

  const second = await launch();
  await second.window.waitForURL(/\/worlds$/);
  const served = await second.window.evaluate(
    async (path) => (await fetch(path)).status,
    `/assets/${WORLD}/${ORIGINAL}`,
  );
  expect(served).toBe(200);
});

test('a folder it must not copy into leaves the Assets and the config exactly as they were', async ({
  launch,
  userDataDir,
}) => {
  const instanceDir = join(userDataDir, 'hexly');

  const run = await launch();
  await run.window.waitForURL(/\/worlds$/);
  const oldRoot = seedAssets(instanceDir);
  // The folder the Assets are already in — the one bad choice a picker makes easy to make by accident.
  await standInForPickerAndRespawn(run.app, join(instanceDir, 'assets'));

  await clickMenuItem(run.app, MOVE_ASSET_STORAGE);

  await expect(run.window.getByTestId('asset-move-reason')).toContainText('already');
  expect(run.output()).not.toContain(RELAUNCH_LINE);
  expect(readFileSync(join(oldRoot, ORIGINAL), 'utf8')).toBe(BYTES);
  // Nothing was written, so there is no config file to have been rewritten either.
  expect(() => readFileSync(join(instanceDir, 'hexly.yml'), 'utf8')).toThrow();
});
