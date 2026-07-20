import { createEntity, enterLibrary, expect, flushSave, test, savedGrid } from './fixtures';

/**
 * The Inspector is the only place a Region's details are edited (CONTEXT.md → Inspector, ADR-0011).
 */
test('selects a Region on the canvas, renames it in the Inspector, and the rename survives a reload', async ({
  page,
  request,
}) => {
  await enterLibrary(page);
  const mapId = await createEntity(page, 'core.type.hex-map');

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
