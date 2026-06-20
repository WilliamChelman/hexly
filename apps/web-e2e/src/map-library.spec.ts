import { expect, test } from './fixtures';

/**
 * The library CRUD journey: create a map, see it listed, open it, and delete it
 * — exercising the list/create/get/delete seams (ADR-0009). The DB reset before
 * each test means the library starts empty.
 */
test('creates, lists, opens, and deletes a map', async ({ page }) => {
  await page.goto('/maps');
  await expect(page.getByTestId('empty')).toBeVisible();

  await page.getByTestId('new-map').click();
  await expect(page).toHaveURL(/\/maps\/[\w-]+$/);
  const mapId = page.url().split('/').pop();

  // Back in the library, the new map is listed.
  await page.getByRole('link', { name: 'All maps' }).click();
  await expect(page).toHaveURL(/\/maps$/);
  await expect(page.getByTestId(`open-${mapId}`)).toBeVisible();
  await expect(page.getByTestId('map-title')).toHaveText('Untitled map');

  // Opening from the library returns to that map's editor.
  await page.getByTestId(`open-${mapId}`).click();
  await expect(page).toHaveURL(new RegExp(`/maps/${mapId}$`));

  // Back, then delete: the card disappears and the library is empty again.
  await page.getByRole('link', { name: 'All maps' }).click();
  await page.getByTestId(`delete-${mapId}`).click();
  await expect(page.getByTestId(`open-${mapId}`)).toHaveCount(0);
  await expect(page.getByTestId('empty')).toBeVisible();
});
