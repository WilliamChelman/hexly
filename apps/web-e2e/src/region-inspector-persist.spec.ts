import { createEntity, enterLibrary, expect, flushSave, test, savedGrid } from './fixtures';

/**
 * The Region select-and-edit journey (issue #39): a Region selected on the canvas
 * with the universal Select tool, renamed in the Inspector — the only place a
 * Region's details are edited (CONTEXT.md → Inspector, ADR-0011) — survives a save
 * and reload. Like the other entity journeys it crosses every seam: canvas
 * selection, the Inspector edit, a versioned save, and a load on reload. We prove
 * the round trip with a direct API read of the persisted document (ADR-0009) and
 * confirm the Inspector re-renders the renamed Region after re-selecting it.
 */
test('selects a Region on the canvas, renames it in the Inspector, and the rename survives a reload', async ({
  page,
  request,
}) => {
  await enterLibrary(page);
  const mapId = await createEntity(page, 'core.hexmap');

  const canvas = page.getByRole('img', { name: 'Hex map' });

  // Create Region from the Regions panel (ADR-0012). New Region arms the Add brush.
  await page.getByTestId('rail-regions').click();
  await page.getByTestId('new-region').click();
  await canvas.click();

  // Select that Region on the canvas. Clicking (0,0) — a Void inside the Region —
  // selects it (ADR-0011), opening the Inspector on its name field.
  await page.getByTestId('tool-select').click();
  await canvas.click();
  await expect(page.getByTestId('region-name')).toHaveValue('Region 1');

  // Tab blurs the field, firing the (change) the Inspector commits on.
  const name = page.getByTestId('region-name');
  await name.fill('The Whisperwood');
  await name.press('Tab');

  await flushSave(page);

  await page.reload();

  const grid = await savedGrid(request, mapId);
  expect(grid.regions).toHaveLength(1);
  expect(grid.regions[0].name).toBe('The Whisperwood');
  expect(grid.regions[0].hexes).toEqual({ '0,0': true });

  // The reloaded map boots in Select (issue #27).
  await canvas.click();
  await expect(page.getByTestId('region-name')).toHaveValue('The Whisperwood');
});
