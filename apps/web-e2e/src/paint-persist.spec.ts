import { createEntity, enterLibrary, expect, flushSave, savedGrid, test } from './fixtures';

/**
 * The keystone journey: it crosses every seam — the session cookie on API calls,
 * canvas input, a versioned save, and a load on reload. Map state lives as Canvas
 * pixels (ADR-0003), so we assert on the model-derived hex count and prove the
 * round trip by reloading; a direct API read confirms the persisted document
 * (ADR-0009).
 */
test('paints a hex, saves, and the hex survives a reload', async ({ page, request }) => {
  await enterLibrary(page);
  const mapId = await createEntity(page, 'core.hexmap');

  // A map opens armed with Select, so a stray click never paints (issue #27).
  await page.getByRole('img', { name: 'Hex map' }).click();
  await expect(page.getByTestId('hex-count')).toHaveText('0 hexes');

  // Pick a non-default terrain so the saved document proves our selection.
  await page.getByTestId('tool-terrain').click();
  await page.getByRole('group', { name: 'Terrain' }).getByRole('button', { name: 'Ocean' }).click();

  await expect(page.getByTestId('hex-count')).toHaveText('0 hexes');

  await page.getByRole('img', { name: 'Hex map' }).click();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');

  await flushSave(page);

  await page.reload();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');

  const grid = await savedGrid(request, mapId);
  const hexes = Object.values(grid.hexes) as Array<{
    terrain: string;
  }>;
  expect(hexes).toHaveLength(1);
  expect(hexes[0].terrain).toBe('ocean');
});
