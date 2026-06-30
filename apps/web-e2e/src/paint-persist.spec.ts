import { enterLibrary, expect, flushSave, readEntity, test } from './fixtures';

/**
 * The keystone journey: it crosses every seam — the session cookie on API calls,
 * canvas input, a versioned save, and a load on reload. Map state lives as Canvas
 * pixels (ADR-0003), so we assert on the model-derived hex count and prove the
 * round trip by reloading; a direct API read confirms the persisted document
 * (ADR-0009).
 */
test('paints a hex, saves, and the hex survives a reload', async ({
  page,
  request,
}) => {
  await enterLibrary(page);
  await page.getByTestId('new-map').click();

  // Creating a map opens the editor at /entities/:id.
  await expect(page).toHaveURL(/\/entities\/[^/]+$/);
  const mapId = page.url().split('/').pop();

  // A map opens armed with the non-destructive Select tool, so a stray first
  // click never paints (issue #27).
  await page.getByRole('img', { name: 'Hex map' }).click();
  await expect(page.getByTestId('hex-count')).toHaveText('0 hexes');

  // Arm the Terrain tool to reveal its swatches, then pick a non-default terrain
  // so the saved document proves our selection rather than the default ('forest').
  await page.getByTestId('tool-terrain').click();
  await page
    .getByRole('group', { name: 'Terrain' })
    .getByRole('button', { name: 'Ocean' })
    .click();

  await expect(page.getByTestId('hex-count')).toHaveText('0 hexes');

  // Paint the centre hex (the canvas centres the world origin on load).
  await page.getByRole('img', { name: 'Hex map' }).click();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');

  await flushSave(page);

  // The seam under test: a fresh load re-fetches and re-renders the saved map.
  await page.reload();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');

  // And the persisted document really holds that one hex, with our terrain.
  const { document } = await readEntity(page, request, mapId);
  const hexes = Object.values(document.hexes) as Array<{
    terrain: string;
  }>;
  expect(hexes).toHaveLength(1);
  expect(hexes[0].terrain).toBe('ocean');
});
