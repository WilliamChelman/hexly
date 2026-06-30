import { enterLibrary, expect, flushSave, readEntity, test } from './fixtures';

/**
 * The Region journey (issue #8, #38, #39, ADR-0012): a region created in the Regions
 * panel and painted onto a hex survives a save and reload. Like the paint and feature
 * journeys it crosses every seam — the panel, canvas input, a versioned save, and a
 * load on reload. Region membership is an independent set of coordinates (CONTEXT.md →
 * Region), so we prove the round trip with a direct API read of the persisted
 * document (ADR-0009) and confirm the Inspector re-renders the loaded region after
 * re-selecting it.
 */
test('creates a region in the panel, paints a hex, saves, and the region survives a reload', async ({
  page,
  request,
}) => {
  await enterLibrary(page);
  await page.getByTestId('new-map').click();

  // Creating a map opens the editor at /entities/:id.
  await expect(page).toHaveURL(/\/entities\/[^/]+$/);
  const mapId = page.url().split('/').pop();

  const canvas = page.getByRole('img', { name: 'Hex map' });

  // Creation lives in the Regions panel now (ADR-0012). Open the right-edge rail's
  // Regions panel and create a Region: New Region mints 'Region 1', selects it (so
  // the Inspector opens on its name field — the earliest observable checkpoint, as
  // membership has no status counter) and arms the Add brush.
  await page.getByTestId('rail-regions').click();
  await page.getByTestId('new-region').click();
  await expect(page.getByTestId('region-name')).toHaveValue('Region 1');

  // Click the centre hex (the canvas centres the world origin on load, so a plain
  // click lands on (0,0)): with the new Region armed in Add, the stroke paints (0,0)
  // into its membership. No terrain needed.
  await canvas.click();

  await flushSave(page);

  // The seam under test: a fresh load re-fetches the saved map.
  await page.reload();

  // Read the persisted document: it proves the round trip held the region with that
  // coordinate in its membership set, and its auto-assigned 'Region 1' name.
  const { document } = await readEntity(page, request, mapId);
  expect(document.regions).toHaveLength(1);
  expect(document.regions[0].hexes).toEqual({ '0,0': true });
  expect(document.regions[0].name).toBe('Region 1');

  // The reloaded map boots in Select (issue #27). Clicking the centre hex selects
  // the Region that contains (0,0) — a Void coordinate inside a Region selects it
  // (ADR-0011) — and the Inspector re-renders its loaded name.
  await canvas.click();
  await expect(page.getByTestId('region-name')).toHaveValue('Region 1');
});
