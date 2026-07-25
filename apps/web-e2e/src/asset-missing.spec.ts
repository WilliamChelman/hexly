import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { enterLibrary, expect, flushSave, instanceDir, openEntity, test } from './fixtures';
import { idFromSegment } from '../../../libs/web-core/src/utils/pretty-id';

// A real 20×8 solid-color PNG — sharp parses it at mint, so the Asset gets Stats and a thumbnail.
const PNG_20x8 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABQAAAAICAIAAAB2/0i6AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFUlEQVQYlWOwyTtBNmIY1XxiiAQYACBM50E1XKcYAAAAAElFTkSuQmCC',
  'base64',
);

/**
 * Missing Asset bytes (#325, ADR-0034 amendment). `assets.dir` moves no existing bytes and an external
 * volume can be unmounted, so an Asset's bytes can go absent while its Entity, Stats and prose stay intact.
 * The app must name that, in its own state — otherwise the user cannot tell "your file is elsewhere" from
 * "your data is gone", and those call for very different reactions.
 *
 * This is the whole user-facing loop against the real filesystem: strand the bytes, see both surfaces say so,
 * put the file back, see it heal with nothing but a reload — no Reindex, because nothing derived went stale.
 */
test('an Asset whose bytes are stranded says so on its page and in the Browser, and heals when restored', async ({
  page,
}) => {
  const worldId = idFromSegment(await enterLibrary(page)); // the raw id the API keys on

  const uploaded = await page.request.post(`/api/worlds/${worldId}/assets`, {
    multipart: { file: { name: 'stranded.png', mimeType: 'image/png', buffer: PNG_20x8 } },
  });
  expect(uploaded.ok(), `${uploaded.status()} ${await uploaded.text()}`).toBeTruthy();
  const asset = await uploaded.json();
  const hash = asset.document['core.field.asset'].hash as string;
  const bytesPath = join(instanceDir, 'assets', worldId, `${hash}.png`);
  expect(existsSync(bytesPath), `expected minted bytes at ${bytesPath}`).toBeTruthy();

  // Healthy: the image renderer draws the bytes and nothing claims anything is missing.
  await openEntity(page, asset.id);
  await expect(page.getByTestId('asset-image')).toBeVisible();
  await expect(page.getByTestId('asset-missing')).toHaveCount(0);

  // Strand the bytes the way an unmounted drive does — the row, the ref and the prose are all untouched.
  rmSync(bytesPath);

  await page.reload();
  const missing = page.getByTestId('asset-missing');
  await expect(missing).toBeVisible();
  // A distinguishable state, not a broken image and not the non-image icon card.
  await expect(page.getByTestId('asset-image')).toHaveCount(0);
  await expect(page.getByTestId('asset-icon-card')).toHaveCount(0);
  // And the Asset's own facts are still there — nothing was lost, which is the point of saying "missing".
  await expect(page.getByTestId('asset-stat-dimensions')).toContainText('20 × 8');

  // Autosave must not unsay it: a save response replaces the client's open Entity wholesale, so authoring
  // prose on a stranded Asset would otherwise clear the state while the file is still gone.
  await page.getByTestId('note-content').click();
  await page.keyboard.type('Where did this go?');
  await flushSave(page);
  await expect(missing).toBeVisible();

  // The Browser grid marks the same Asset, so the state is visible where Assets are shown, not only on open.
  await page.getByTestId('nav-assets').click();
  await page.waitForURL(/\/w\/[\w-]+\/assets$/);
  await expect(page.getByTestId(`asset-missing-${asset.id}`)).toBeVisible();

  // Put the file back: the state is one stat per read, so a reload clears it — no Reindex.
  writeFileSync(bytesPath, PNG_20x8);
  await page.reload();
  await expect(page.getByTestId(`asset-missing-${asset.id}`)).toHaveCount(0);

  await openEntity(page, asset.id);
  await expect(page.getByTestId('asset-image')).toBeVisible();
  await expect(page.getByTestId('asset-missing')).toHaveCount(0);
});
