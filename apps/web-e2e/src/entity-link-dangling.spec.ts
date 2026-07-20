import { createEntity, enterLibrary, entityIdFromUrl, expect, flushSave, test, savedGrid } from './fixtures';

/**
 * Dangling Entity Link journey (issue #78, CONTEXT.md → Entity Link, ADR-0018): a link whose
 * target is deleted — or is not resolvable for the current user — renders visible but not
 * followable, and the referencing map still opens. `entityId` is not referentially enforced:
 * deleting the target neither cascades to nor corrupts the Map element; the id stays in the
 * document and simply stops resolving.
 */
test('a link whose target is deleted renders non-navigable, and the map opens without error', async ({
  page,
  request,
}) => {
  await enterLibrary(page);
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const noteId = entityIdFromUrl(page);

  await enterLibrary(page);
  const mapId = await createEntity(page, 'core.type.hex-map');

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

  // Delete the target out from under the link (the "inaccessible/missing" case).
  const del = await request.delete(`/api/entities/${noteId}`);
  expect(del.ok()).toBeTruthy();

  await page.reload();
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');

  // No cascade, no corruption: the document still carries the link id (AC3).
  const grid = await savedGrid(request, mapId);
  expect(grid.hexes['0,0']?.entityId).toBe(noteId);

  // Re-select the hex: the Inspector shows the link as non-navigable.
  await canvas.click();
  await expect(page.getByTestId('entity-link-dangling')).toBeVisible();
  await expect(page.getByTestId('entity-link-name')).toHaveCount(0);

  await page.getByTestId('entity-link-remove').click();
  await expect(page.getByTestId('entity-link-dangling')).toHaveCount(0);
  await expect(page.getByTestId('entity-link-pick')).toBeVisible();
});
