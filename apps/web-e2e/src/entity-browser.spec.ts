import { expect, test } from './fixtures';

/**
 * The Entity browser lifecycle (#70): create an Entity, see it listed with its
 * type, open it, rename it in place, and delete it — exercising the generalized
 * list/create/open/rename/delete seams over the one type-dispatching route
 * (`/entities/:id`). The DB reset before each test means the browser starts empty.
 */
test('a note round-trips: create → appears → open → rename → delete', async ({
  page,
}) => {
  await page.goto('/entities');
  await expect(page.getByTestId('empty')).toBeVisible();

  // Create a note: it opens the minimal note view at /entities/:id.
  await page.getByTestId('new-note').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const id = page.url().split('/').pop();
  await expect(page.getByTestId('note-title')).toHaveText('Untitled note');

  // Back in the browser, the note is listed with its type.
  await page.getByTestId('back-to-library').click();
  await expect(page).toHaveURL(/\/entities$/);
  await expect(page.getByTestId(`open-${id}`)).toBeVisible();
  await expect(page.getByTestId(`type-${id}`)).toHaveText('Note');

  // Rename it in place (name only).
  await page.getByTestId(`rename-${id}`).click();
  const input = page.getByTestId(`rename-input-${id}`);
  await input.fill('Lady Mara');
  await input.press('Enter');
  await expect(page.getByTestId('map-title')).toHaveText('Lady Mara');

  // Opening from the browser returns to that note's view, now renamed.
  await page.getByTestId(`open-${id}`).click();
  await expect(page).toHaveURL(new RegExp(`/entities/${id}$`));
  await expect(page.getByTestId('note-title')).toHaveText('Lady Mara');

  // Back, then delete: the card disappears and the browser is empty again.
  await page.getByTestId('back-to-library').click();
  await page.getByTestId(`delete-${id}`).click();
  await expect(page.getByTestId(`open-${id}`)).toHaveCount(0);
  await expect(page.getByTestId('empty')).toBeVisible();
});

test('creating a map opens the map editor, not the note view', async ({
  page,
}) => {
  await page.goto('/entities');

  await page.getByTestId('new-map').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);

  // The editor chrome (the editable map title) is present; the note view is not.
  await expect(page.getByTestId('title')).toBeVisible();
  await expect(page.getByTestId('note-title')).toHaveCount(0);

  // The editor header's "All maps" link returns to the library (retargeted from
  // /maps to /entities in #70).
  await page.getByRole('link', { name: 'All maps' }).click();
  await expect(page).toHaveURL(/\/entities$/);
});
