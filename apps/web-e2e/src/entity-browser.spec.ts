import { enterLibrary, expect, test } from './fixtures';

/**
 * Entity browser lifecycle (#70): create → list → open → rename → delete, over
 * the type-dispatching route (`/entities/:id`). DB is reset before each test.
 */
test('a note round-trips: create → appears → open → rename → delete', async ({
  page,
}) => {
  await enterLibrary(page);
  await expect(page.getByTestId('empty')).toBeVisible();

  // Create a note: opens the minimal note view at /entities/:id.
  await page.getByTestId('new-note').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const id = page.url().split('/').pop();
  await expect(page.getByTestId('title')).toHaveText('Untitled note');

  await page.getByRole('link', { name: 'Library' }).click();
  await expect(page).toHaveURL(/\/entities$/);
  await expect(page.getByTestId(`open-${id}`)).toBeVisible();
  await expect(page.getByTestId(`type-${id}`)).toHaveText('Note');

  // Rename in place (name only — not body content).
  await page.getByTestId(`rename-${id}`).click();
  const input = page.getByTestId(`rename-input-${id}`);
  await input.fill('Lady Mara');
  await input.press('Enter');
  await expect(page.getByTestId('entity-title')).toHaveText('Lady Mara');

  await page.getByTestId(`open-${id}`).click();
  await expect(page).toHaveURL(new RegExp(`/entities/${id}$`));
  await expect(page.getByTestId('title')).toHaveText('Lady Mara');

  await page.getByRole('link', { name: 'Library' }).click();
  await page.getByTestId(`delete-${id}`).click();
  await expect(page.getByTestId(`open-${id}`)).toHaveCount(0);
  await expect(page.getByTestId('empty')).toBeVisible();
});

test('creating a map opens the map editor, not the note view', async ({
  page,
}) => {
  await enterLibrary(page);

  await page.getByTestId('new-map').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);

  // Editor chrome present (harmonized header — ADR-0022).
  await expect(page.getByTestId('title')).toBeVisible();

  // App navigation lives in the rail now (ADR-0022): Library returns to the browser.
  await page.getByRole('link', { name: 'Library' }).click();
  await expect(page).toHaveURL(/\/entities$/);
});
