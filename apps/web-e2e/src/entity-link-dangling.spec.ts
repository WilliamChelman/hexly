import { expect, test, waitForSave } from './fixtures';

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
  // Seed the link target, then delete it after linking.
  await page.goto('/entities');
  await page.getByTestId('new-note').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const noteId = page.url().split('/').pop();

  // The source: a fresh map with one painted hex.
  await page.goto('/entities');
  await page.getByTestId('new-map').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const mapId = page.url().split('/').pop();

  const canvas = page.getByRole('img', { name: 'Hex map' });

  await page.getByTestId('tool-terrain').click();
  await page
    .getByRole('group', { name: 'Terrain' })
    .getByRole('button', { name: 'Ocean' })
    .click();
  await canvas.click();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');

  // Link the hex to the note, then save.
  await page.getByTestId('tool-select').click();
  await canvas.click();
  await page.getByTestId('entity-link-pick').click();
  await page.getByTestId(`entity-link-option-${noteId}`).click();
  await expect(page.getByTestId('entity-link-name')).toBeVisible();

  const saved = waitForSave(page);
  await page.getByTestId('save').click();
  await saved;
  await expect(page.getByTestId('save')).toHaveText('Save');

  // Delete the target out from under the link (the "inaccessible/missing" case).
  const del = await request.delete(`/api/entities/${noteId}`);
  expect(del.ok()).toBeTruthy();

  // The map opens cleanly on a fresh load despite the now-dangling link.
  await page.reload();
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');

  // No cascade, no corruption: the document still carries the link id (AC3).
  const res = await request.get(`/api/entities/${mapId}`);
  expect(res.ok()).toBeTruthy();
  const detail = await res.json();
  expect(detail.document.hexes['0,0']?.entityId).toBe(noteId);

  // Re-select the hex: the Inspector shows the link as non-navigable — visible but
  // not a followable link (no `entity-link-name` anchor).
  await canvas.click();
  await expect(page.getByTestId('entity-link-dangling')).toBeVisible();
  await expect(page.getByTestId('entity-link-name')).toHaveCount(0);

  // The remove control still works on a dangling link, clearing it from the doc.
  await page.getByTestId('entity-link-remove').click();
  await expect(page.getByTestId('entity-link-dangling')).toHaveCount(0);
  await expect(page.getByTestId('entity-link-pick')).toBeVisible();
});
