import { createEntity, enterLibrary, entityIdFromUrl, expect, flushSave, segRe, test, savedGrid } from './fixtures';

/** The Entity Link journey (issue #76, CONTEXT.md → Entity Link). */
test('links a Hex to an Entity in the Inspector; the link survives a reload and is followable', async ({
  page,
  request,
}) => {
  await enterLibrary(page);
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const noteId = entityIdFromUrl(page);

  await enterLibrary(page);
  const mapId = await createEntity(page, 'core.hexmap');

  const canvas = page.getByRole('img', { name: 'Hex map' });

  await page.getByTestId('tool-terrain').click();
  await page.getByRole('group', { name: 'Terrain' }).getByRole('button', { name: 'Ocean' }).click();
  await canvas.click();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');

  await page.getByTestId('tool-select').click();
  await canvas.click();
  await page.getByTestId('entity-link-pick').click();
  await page.getByTestId(`entity-link-option-${noteId}`).click();
  await expect(page.getByTestId('entity-link-name')).toBeVisible();

  await flushSave(page);

  await page.reload();

  const grid = await savedGrid(request, mapId);
  expect(grid.hexes['0,0']?.entityId).toBe(noteId);

  await canvas.click();
  await expect(page.getByTestId('entity-link-name')).toBeVisible();

  await page.getByTestId('entity-link-name').click();
  await expect(page).toHaveURL(new RegExp(`/entities/${segRe(noteId)}$`));
});
