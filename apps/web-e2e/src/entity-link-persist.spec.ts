import { expect, flushSave, test } from './fixtures';

/**
 * The Entity Link journey (issue #76, CONTEXT.md → Entity Link): a Map element —
 * here a painted Hex — is linked from the Inspector to another Entity, and the
 * link survives a save and reload and stays followable. Like the other entity
 * journeys it crosses every seam: canvas paint and selection, the Inspector edit,
 * a versioned save, and a load on reload. We prove the round trip with a direct
 * API read of the persisted document (ADR-0009) and confirm the Inspector
 * re-renders the link after re-selecting the hex, then that Follow navigates to
 * the linked Entity. Prior art: region-inspector-persist.spec.ts.
 */
test('links a Hex to an Entity in the Inspector; the link survives a reload and is followable', async ({
  page,
  request,
}) => {
  // Seed the link target: a note the picker can list and Follow can jump to.
  await page.goto('/entities');
  await page.getByTestId('new-note').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const noteId = page.url().split('/').pop();

  // The source: a fresh map.
  await page.goto('/entities');
  await page.getByTestId('new-map').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const mapId = page.url().split('/').pop();

  const canvas = page.getByRole('img', { name: 'Hex map' });

  // Paint the centre hex (the canvas centres the world origin on load).
  await page.getByTestId('tool-terrain').click();
  await page
    .getByRole('group', { name: 'Terrain' })
    .getByRole('button', { name: 'Ocean' })
    .click();
  await canvas.click();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');

  // The journey under test: select the hex, open the Entity Link picker, and link
  // the note. The picker lists the owner's entities (notes and maps); pick by id.
  await page.getByTestId('tool-select').click();
  await canvas.click();
  await page.getByTestId('entity-link-pick').click();
  await page.getByTestId(`entity-link-option-${noteId}`).click();
  await expect(page.getByTestId('entity-link-name')).toBeVisible();

  await flushSave(page);

  // The seam under test: a fresh load re-fetches the saved map.
  await page.reload();

  // The persisted document really holds the Entity Link on the hex.
  const res = await request.get(`/api/entities/${mapId}`);
  expect(res.ok()).toBeTruthy();
  const detail = await res.json();
  expect(detail.document.hexes['0,0']?.entityId).toBe(noteId);

  // Re-select the hex: the Inspector shows the persisted link, ready to follow.
  await canvas.click();
  await expect(page.getByTestId('entity-link-name')).toBeVisible();

  // The entity name is itself the link — clicking it jumps to the linked Entity.
  await page.getByTestId('entity-link-name').click();
  await expect(page).toHaveURL(new RegExp(`/entities/${noteId}$`));
});
