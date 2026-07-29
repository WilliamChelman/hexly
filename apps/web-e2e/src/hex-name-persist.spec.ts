import { createEntity, enterEntities, expect, flushSave, test, savedGrid } from './fixtures';

/**
 * A hex name is structured metadata bound to its coordinate (ADR-0016), distinct from a
 * free Label. Canvas pixels are opaque to Playwright (ADR-0003), so this spec proves
 * persistence via a direct API read (ADR-0009) plus re-editing after re-selection; the
 * renderer's drawing of the name is covered by the FakeContext unit tests.
 */
test('names a painted hex in the Inspector, and the name survives a reload', async ({ page, request }) => {
  await enterEntities(page);
  const mapId = await createEntity(page, 'core.type.hex-map');

  const canvas = page.getByRole('img', { name: 'Hex map' });

  // Paint a non-default terrain so the saved document is unambiguous.
  await page.getByTestId('tool-terrain').click();
  await page.getByRole('group', { name: 'Terrain' }).getByRole('button', { name: 'Ocean' }).click();
  await canvas.click();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');

  // Tab blurs the field, firing the (change) the Inspector commits on.
  await page.getByTestId('tool-select').click();
  await canvas.click();
  const name = page.getByTestId('entity-name');
  await expect(name).toHaveValue('');
  await name.fill('Riverbend');
  await name.press('Tab');

  await flushSave(page);

  await page.reload();

  const grid = await savedGrid(request, mapId);
  expect(grid.hexes['0,0']).toEqual({
    terrain: 'ocean',
    name: 'Riverbend',
  });

  // The reloaded map boots in Select (issue #27). Clicking the centre re-selects the hex.
  await canvas.click();
  await expect(page.getByTestId('entity-name')).toHaveValue('Riverbend');
});
