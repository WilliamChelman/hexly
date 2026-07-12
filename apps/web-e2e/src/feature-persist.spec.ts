import { createEntity, enterLibrary, expect, flushSave, test } from './fixtures';

/**
 * The Feature journey (issue #7): a feature placed on a hex survives a save and
 * reload. Like the paint journey it crosses every seam — canvas input, a
 * versioned save, and a load on reload. Map state lives as Canvas pixels
 * (ADR-0003), so we assert on the model-derived hex count and prove the round
 * trip with a direct API read of the persisted document (ADR-0009).
 */
test('places a feature on a hex, saves, and the feature survives a reload', async ({ page, request }) => {
  await enterLibrary(page);
  const mapId = await createEntity(page, 'core.hexmap');

  const canvas = page.getByRole('img', { name: 'Hex map' });

  // A Feature rides on an existing Hex, so paint the centre hex first (issue #27).
  await page.getByTestId('tool-terrain').click();
  await canvas.click();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');

  await page.getByTestId('tool-feature').click();
  await page.getByRole('group', { name: 'Features' }).getByRole('button', { name: 'Settlement' }).click();
  await canvas.click();

  await flushSave(page);

  await page.reload();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');

  const res = await request.get(`/api/entities/${mapId}`);
  expect(res.ok()).toBeTruthy();
  const detail = await res.json();
  const hexes = Object.values(detail.document.hexes) as Array<{
    terrain: string;
    feature?: { ref: string };
  }>;
  expect(hexes).toHaveLength(1);
  expect(hexes[0].feature).toEqual({ ref: 'settlement' });
});
