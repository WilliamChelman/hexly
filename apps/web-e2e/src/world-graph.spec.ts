import { enterLibrary, entityIdFromUrl, expect, flushSave, test } from './fixtures';

/**
 * The World Graph journey (#181), and its generic show-orphans toggle (ADR-0065, #283). A linked
 * pair draws by default; a link-less Entity — any type, an unreferenced Asset chief among them — is
 * an orphan the graph hides until the toggle asks for it.
 */
test('hides orphan entities behind a generic show-orphans toggle', async ({ page }) => {
  const worldId = await enterLibrary(page);

  // The link target: a note the source can point at.
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const targetId = entityIdFromUrl(page);

  // The source note, linked to the target via an @-mention — one edge, two non-orphan nodes.
  await enterLibrary(page);
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  await page.getByTestId('note-content').click();
  await page.keyboard.type('@');
  await expect(page.getByTestId('entity-picker')).toBeVisible();
  await page.getByTestId(`entity-picker-option-${targetId}`).click();
  await expect(page.getByTestId('entity-link')).toBeVisible();
  await flushSave(page);

  // A third note left unlinked — the orphan.
  await enterLibrary(page);
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);

  await page.goto(`/w/${worldId}/graph`);

  // Default: only the linked pair is drawn; the orphan is counted out.
  const counts = page.getByTestId('graph-counts');
  await expect(counts).toContainText('2 entities');
  await expect(counts).toContainText('1 links');

  // The toggle lives in the graph's floating filters menu, which closes on select — so reading its
  // state means opening the menu again.
  const filters = page.getByTestId('graph-filters');
  await filters.click();
  const toggle = page.getByTestId('graph-orphans-toggle');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');

  // Flip it: the orphan joins the picture, the edge count holds.
  await toggle.click();
  await expect(counts).toContainText('3 entities');
  await expect(counts).toContainText('1 links');
  await filters.click();
  await expect(page.getByTestId('graph-orphans-toggle')).toHaveAttribute('aria-checked', 'true');
});
