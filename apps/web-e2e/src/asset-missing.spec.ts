import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { enterEntities, expect, flushSave, instanceDir, openEntity, test } from './fixtures';
import { idFromSegment } from '../../../libs/web-core/src/utils/pretty-id';

// A real 20×8 solid-color PNG — sharp parses it at mint, so the Asset gets Stats and a thumbnail.
const PNG_20x8 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABQAAAAICAIAAAB2/0i6AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFUlEQVQYlWOwyTtBNmIY1XxiiAQYACBM50E1XKcYAAAAAElFTkSuQmCC',
  'base64',
);

/**
 * Missing Asset bytes (#325, ADR-0034 amendment): `assets.dir` moves no existing bytes and a volume can be
 * unmounted, so bytes can go absent while the Entity, Stats and prose stay intact. The whole loop against
 * the real filesystem — strand the bytes, see both surfaces say so, restore, see it heal on a reload.
 */
test('an Asset whose bytes are stranded says so on its page and in the Browser, and heals when restored', async ({
  page,
}) => {
  const worldId = idFromSegment(await enterEntities(page)); // the raw id the API keys on

  const uploaded = await page.request.post(`/api/worlds/${worldId}/assets`, {
    multipart: { file: { name: 'stranded.png', mimeType: 'image/png', buffer: PNG_20x8 } },
  });
  expect(uploaded.ok(), `${uploaded.status()} ${await uploaded.text()}`).toBeTruthy();
  const asset = await uploaded.json();
  const hash = asset.document['core.field.asset'].hash as string;
  const bytesPath = join(instanceDir, 'assets', worldId, `${hash}.png`);
  expect(existsSync(bytesPath), `expected minted bytes at ${bytesPath}`).toBeTruthy();

  await openEntity(page, asset.id);
  await expect(page.getByTestId('asset-image')).toBeVisible();
  await expect(page.getByTestId('asset-missing')).toHaveCount(0);

  // Strand the bytes the way an unmounted drive does: the row, the ref and the prose stay untouched.
  rmSync(bytesPath);

  await page.reload();
  const missing = page.getByTestId('asset-missing');
  await expect(missing).toBeVisible();
  await expect(page.getByTestId('asset-image')).toHaveCount(0);
  await expect(page.getByTestId('asset-icon-card')).toHaveCount(0);
  await expect(page.getByTestId('asset-stat-dimensions')).toContainText('20 × 8');

  // Autosave must not unsay it: a save response replaces the client's open Entity wholesale.
  await page.getByTestId('note-content').click();
  await page.keyboard.type('Where did this go?');
  await flushSave(page);
  await expect(missing).toBeVisible();

  await page.getByTestId('nav-assets').click();
  await page.waitForURL(/\/w\/[\w-]+\/assets$/);
  await expect(page.getByTestId(`asset-missing-${asset.id}`)).toBeVisible();

  // The state is one stat per read, so a reload clears it — no Reindex.
  writeFileSync(bytesPath, PNG_20x8);
  await page.reload();
  await expect(page.getByTestId(`asset-missing-${asset.id}`)).toHaveCount(0);

  await openEntity(page, asset.id);
  await expect(page.getByTestId('asset-image')).toBeVisible();
  await expect(page.getByTestId('asset-missing')).toHaveCount(0);
});
