import { createEntity, enterLibrary, expect, flushSave, test } from './fixtures';

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
  const mapId = await createEntity(page, 'core.hexmap');

  const canvas = page.getByRole('img', { name: 'Hex map' });

  // Create Region in the Regions panel (ADR-0012). New Region arms the Add brush.
  await page.getByTestId('rail-regions').click();
  await page.getByTestId('new-region').click();
  await expect(page.getByTestId('region-name')).toHaveValue('Region 1');

  // Click the centre hex to paint (0,0) into its membership.
  await canvas.click();

  await flushSave(page);

  await page.reload();

  const res = await request.get(`/api/entities/${mapId}`);
  expect(res.ok()).toBeTruthy();
  const detail = await res.json();
  expect(detail.document.regions).toHaveLength(1);
  expect(detail.document.regions[0].hexes).toEqual({ '0,0': true });
  expect(detail.document.regions[0].name).toBe('Region 1');

  // The reloaded map boots in Select (issue #27). Void inside a Region selects it (ADR-0011).
  await canvas.click();
  await expect(page.getByTestId('region-name')).toHaveValue('Region 1');
});
