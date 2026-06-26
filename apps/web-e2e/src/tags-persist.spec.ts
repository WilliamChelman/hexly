import { expect, test, waitForSave } from './fixtures';

/**
 * Full-stack tag round-trip (#72): add free-text tags on a note → versioned save →
 * reload re-renders them → the library reflects them. Tags ride the same version-
 * checked save as Content and are stored as Entity metadata (ADR-0018).
 */
test('adds tags on a note, saves, and they survive reload and show in the library', async ({
  page,
  request,
}) => {
  await page.goto('/entities');
  await page.getByTestId('new-note').click();

  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const noteId = page.url().split('/').pop();

  // Add two tags through the editor: comma-separated entry adds both at once.
  const tagInput = page.getByTestId('tag-input');
  await tagInput.fill('deity, ruined');
  await tagInput.press('Enter');
  const tags = page.getByTestId('entity-tags');
  await expect(tags).toContainText('deity');
  await expect(tags).toContainText('ruined');

  // Remove one before saving, to prove removal persists too.
  await page.getByTestId('tag-remove-ruined').click();
  await expect(tags).not.toContainText('ruined');

  const saved = waitForSave(page);
  await page.getByTestId('save').click();
  await saved;
  await expect(page.getByTestId('save')).toHaveText('Save');

  await page.reload();
  await expect(page.getByTestId('entity-tags')).toContainText('deity');
  await expect(page.getByTestId('entity-tags')).not.toContainText('ruined');

  // The library reflects the entity's current tags.
  await page.getByTestId('back-to-library').click();
  await expect(page.getByTestId(`tags-${noteId}`)).toContainText('deity');
  await expect(page.getByTestId(`tags-${noteId}`)).not.toContainText('ruined');

  // And the tags are stored as Entity metadata, not in the document body.
  const res = await request.get(`/api/entities/${noteId}`);
  expect(res.ok()).toBeTruthy();
  expect((await res.json()).tags).toEqual(['deity']);
});
