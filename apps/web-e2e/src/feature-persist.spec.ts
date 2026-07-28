import { createEntity, enterEntities, expect, flushSave, test, savedGrid } from './fixtures';

/**
 * A feature placed on a hex survives a save and reload. Canvas pixels are opaque to
 * Playwright (ADR-0003), so we assert on the model-derived hex count and on a direct
 * API read of the persisted document (ADR-0009).
 */
test('places a feature on a hex, saves, and the feature survives a reload', async ({ page, request }) => {
  await enterEntities(page);
  const mapId = await createEntity(page, 'core.type.hex-map');

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

  const grid = await savedGrid(request, mapId);
  const hexes = Object.values(grid.hexes) as Array<{
    terrain: string;
    feature?: { ref: string };
  }>;
  expect(hexes).toHaveLength(1);
  expect(hexes[0].feature).toEqual({ ref: 'settlement' });
});
