import { createEntity, enterLibrary, entityIdFromUrl, expect, flushSave, test, savedGrid } from './fixtures';

/**
 * Dangling Entity Link journey (issue #78, CONTEXT.md → Entity Link, ADR-0018): a
 * Map element linked to an Entity that is later deleted (or otherwise not
 * resolvable for the current user) must render its link **non-navigable** — visible
 * but not followable — and the referencing map must still open without error.
 * `entityId` is not referentially enforced, so deleting the target neither cascades
 * to nor corrupts the Map element; the id stays in the document and simply stops
 * resolving. We exercise the real path: link a hex, save, delete the target via the
 * API (ADR-0009 seam), reload, and assert the Inspector shows the non-navigable
 * state while the persisted document still carries the id. Prior art:
 * entity-link-persist.spec.ts.
 */
test('a link whose target is deleted renders non-navigable, and the map opens without error', async ({
  page,
  request,
}) => {
  await enterLibrary(page);
  await page.getByTestId('new-note').click();
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
