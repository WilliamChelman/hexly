import { enterLibrary, expect, flushSave, readEntity, test } from './fixtures';

/**
 * The hex-name journey (issue #60, ADR-0016): a painted Hex is named in the
 * Inspector — structured metadata bound to its coordinate, distinct from a free
 * Label — and the name survives a save and reload. Like the other entity journeys
 * it crosses every seam: canvas paint and selection, the Inspector edit, a
 * versioned save, and a load on reload. We prove the round trip with a direct API
 * read of the persisted document (ADR-0009) and confirm the Inspector re-renders
 * the name after re-selecting the hex, so it stays editable. The renderer's
 * drawing of the name is covered by the FakeContext unit tests; canvas pixels are
 * opaque to Playwright (ADR-0003), so this spec proves persistence and re-editing.
 */
test('names a painted hex in the Inspector, and the name survives a reload', async ({
  page,
  request,
}) => {
  await enterLibrary(page);
  await page.getByTestId('new-map').click();

  // Creating a map opens the editor at /entities/:id.
  await expect(page).toHaveURL(/\/entities\/[^/]+$/);
  const mapId = page.url().split('/').pop();

  const canvas = page.getByRole('img', { name: 'Hex map' });

  // Paint the centre hex (the canvas centres the world origin on load), picking a
  // non-default terrain so the saved document is unambiguous.
  await page.getByTestId('tool-terrain').click();
  await page
    .getByRole('group', { name: 'Terrain' })
    .getByRole('button', { name: 'Ocean' })
    .click();
  await canvas.click();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');

  // The journey under test: select that hex with the universal Select tool, so the
  // Inspector opens on it, and name it. Tab blurs the field, firing the (change)
  // the Inspector commits on.
  await page.getByTestId('tool-select').click();
  await canvas.click();
  const name = page.getByTestId('entity-name');
  await expect(name).toHaveValue('');
  await name.fill('Riverbend');
  await name.press('Tab');

  await flushSave(page);

  // The seam under test: a fresh load re-fetches the saved map.
  await page.reload();

  // The persisted document really holds the named hex.
  const { document } = await readEntity(page, request, mapId);
  expect(document.hexes['0,0']).toEqual({ terrain: 'ocean', name: 'Riverbend' });

  // The reloaded map boots in Select (issue #27). Clicking the centre re-selects the
  // re-rendered hex, and the Inspector shows its persisted name, ready to re-edit.
  await canvas.click();
  await expect(page.getByTestId('entity-name')).toHaveValue('Riverbend');
});
