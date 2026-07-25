import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { parse } from 'yaml';
import { clickMenuItem, expect, test } from './desktop-app';

/** The menu item's id, restated: main and the SPA are two bundles, and this suite drives the shell's one. */
const MOVE_ASSET_STORAGE = 'move-asset-storage';

/** A World's folder and a content-addressed pair inside it, as an upload would leave them (ADR-0034). */
const WORLD = 'w-seeded';
const ORIGINAL = 'abc123.png';
const THUMBNAIL = 'abc123.thumb.webp';
const BYTES = 'not really a png, but bytes are bytes';

/** What the stubbed `app.relaunch` writes, so the restart can be read off main's output. */
const RELAUNCH_LINE = '[spec] relaunch requested';

/**
 * Stand in for the native picker, which no runner can drive, and for the **respawn** only — a process that
 * relaunches itself detaches from Playwright and takes the single-instance lock with it. `app.quit` is
 * deliberately left alone: the ordered quit that follows the relaunch is part of what is under test, and
 * Playwright's own `close()` goes through it.
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
  // The thumbnail is a sibling of the original, and a move that dropped it would leave every tile blank.
  writeFileSync(join(root, THUMBNAIL), `thumbnail of ${BYTES}`);
  return root;
}

/**
 * The Desktop App moves Asset storage for you (#326). Everything but the respawn is real here: the menu item,
 * the Command, the preload bridge, the copy, the per-file hash check, the `hexly.yml` write and the restart the
 * app performs on itself — then a second launch, with the old folder deleted, proves the bytes are being served
 * from the one that was chosen.
 */
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

  // The move ends in a restart the app performs itself, because config is read once at boot (ADR-0070) — so
  // the app going away *is* the success signal, and waiting for it is also what makes the rest race-free.
  await first.app.waitForEvent('close');
  expect(first.output()).toContain(RELAUNCH_LINE);

  expect(readFileSync(join(chosen, WORLD, ORIGINAL), 'utf8')).toBe(BYTES);
  expect(readFileSync(join(chosen, WORLD, THUMBNAIL), 'utf8')).toBe(`thumbnail of ${BYTES}`);
  // The originals stay, so a move that went wrong is recoverable by hand.
  expect(readFileSync(join(oldRoot, ORIGINAL), 'utf8')).toBe(BYTES);
  // And the switch itself: the one key #324 reads the root from.
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

/** The failure path, whole: a refusal reaches the surface the user is watching, and nothing moved. */
test('a folder it must not copy into leaves the Assets and the config exactly as they were', async ({
  launch,
  userDataDir,
}) => {
  const instanceDir = join(userDataDir, 'hexly');

  const run = await launch();
  await run.window.waitForURL(/\/worlds$/);
  const oldRoot = seedAssets(instanceDir);
  // The folder the Assets are already in: an 8 GB copy that would change nothing, and the one choice a picker
  // makes easy to make by accident.
  await standInForPickerAndRespawn(run.app, join(instanceDir, 'assets'));

  await clickMenuItem(run.app, MOVE_ASSET_STORAGE);

  await expect(run.window.getByTestId('asset-move-reason')).toContainText('already');
  expect(run.output()).not.toContain(RELAUNCH_LINE);
  expect(readFileSync(join(oldRoot, ORIGINAL), 'utf8')).toBe(BYTES);
  // Nothing was written, so there is no config file to have been rewritten either.
  expect(() => readFileSync(join(instanceDir, 'hexly.yml'), 'utf8')).toThrow();
});
