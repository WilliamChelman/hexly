import { enterLibrary, entityIdFromUrl, expect, segRe, test } from './fixtures';

/**
 * Entity browser lifecycle (#70): create → list → open → rename → delete, over
 * the type-dispatching route (`/entities/:id`). DB is reset before each test.
 */
test('a note round-trips: create → appears → open → rename → delete', async ({
  page,
}) => {
  await enterLibrary(page);
  await expect(page.getByTestId('empty')).toBeVisible();

  await page.getByTestId('new-note').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const id = entityIdFromUrl(page);
  await expect(page.getByTestId('title')).toHaveText('Untitled note');

  await page.getByRole('link', { name: 'Library' }).click();
  await expect(page).toHaveURL(/\/entities$/);
  await expect(page.getByTestId(`open-${id}`)).toBeVisible();
  await expect(page.getByTestId(`type-${id}`)).toHaveText('Note');

  await page.getByTestId(`rename-${id}`).click();
  const input = page.getByTestId(`rename-input-${id}`);
  await input.fill('Lady Mara');
  await input.press('Enter');
  await expect(page.getByTestId('entity-title')).toHaveText('Lady Mara');

  await page.getByTestId(`open-${id}`).click();
  await expect(page).toHaveURL(new RegExp(`/entities/${segRe(id)}$`));
  await expect(page.getByTestId('title')).toHaveText('Lady Mara');

  await page.getByRole('link', { name: 'Library' }).click();
  await page.getByTestId(`delete-${id}`).click();
  await expect(page.getByTestId(`open-${id}`)).toHaveCount(0);
  await expect(page.getByTestId('empty')).toBeVisible();
});

// Entity Visibility (ADR-0037, #160): an Owner toggles a note between private and
// shared from the header, and the Entity Browser's access-scoped Visibility facet
// reflects the change — a still-private note is absent from the Shared facet, and
// appears in it once revealed.
test('an owner toggles a note to shared and the Visibility facet reflects it', async ({
  page,
}) => {
  await enterLibrary(page);

  await page.getByTestId('new-note').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const id = entityIdFromUrl(page);

  // New notes default to private: the header toggle reads "not shared".
  await expect(page.getByTestId('visibility-toggle')).toHaveAttribute('aria-pressed', 'false');

  // In the browser it counts under the Private facet, not Shared.
  await page.getByRole('link', { name: 'Library' }).click();
  await page.getByTestId('facet-visibility-private').click();
  await expect(page.getByTestId(`open-${id}`)).toBeVisible();
  // Clear the filter, reopen, and reveal it: the toggle flips to shared.
  await page.getByTestId('facet-visibility-private').click();
  await page.getByTestId(`open-${id}`).click();
  await page.getByTestId('visibility-toggle').click();
  await expect(page.getByTestId('visibility-toggle')).toHaveAttribute('aria-pressed', 'true');

  // The access-scoped Visibility facet now lists it under Shared instead.
  await page.getByRole('link', { name: 'Library' }).click();
  await page.getByTestId('facet-visibility-shared').click();
  await expect(page.getByTestId(`open-${id}`)).toBeVisible();
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
