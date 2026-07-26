import { createEntity, enterLibrary, entityIdFromUrl, expect, openEntityActions, segRe, test } from './fixtures';
import { idFromSegment } from '../../../libs/web-core/src/utils/pretty-id';

test('a note round-trips: create → appears → open → rename → delete', async ({ page }) => {
  await enterLibrary(page);
  await expect(page.getByTestId('empty')).toBeVisible();

  await page.getByTestId('new-default-entity').click();
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
  // Delete goes through the usage-aware confirmation (ADR-0065): an unreferenced note shows the
  // plain prompt, and only the Delete button in the dialog commits it.
  await page.getByTestId(`delete-${id}`).click();
  await expect(page.getByTestId('delete-prompt')).toBeVisible();
  await page.getByTestId('delete-confirm').click();
  await expect(page.getByTestId(`open-${id}`)).toHaveCount(0);
  await expect(page.getByTestId('empty')).toBeVisible();
});

/**
 * The create dialog returns its Entity and navigates nowhere (ADR-0073); landing the author on what
 * they just made is this Command's own doing, so the palette journey has to be walked to see it.
 */
test('the Command palette’s Create Note opens the Entity the dialog returns, and cancelling stays put', async ({
  page,
}) => {
  await enterLibrary(page);

  await page.keyboard.press('ControlOrMeta+k');
  await page.getByTestId('command-palette-input').fill('>note');
  await page.getByTestId('command-palette-option-create-core.type.note').click();

  await page.getByTestId('create-entity-name').fill('Lady Mara');
  await page.getByTestId('create-entity-submit').click();

  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  await expect(page.getByTestId('title')).toHaveText('Lady Mara');

  // And a cancelled dialog leaves the author where they were.
  await page.getByRole('link', { name: 'Library' }).click();
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByTestId('command-palette-input').fill('>note');
  await page.getByTestId('command-palette-option-create-core.type.note').click();
  await page.getByTestId('create-entity-cancel').click();
  await expect(page).toHaveURL(/\/entities$/);
});

test('an owner toggles a note to shared and the Visibility facet reflects it', async ({ page }) => {
  await enterLibrary(page);

  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const id = entityIdFromUrl(page);

  // New notes default to private: the actions menu's Visibility item reads "not shared".
  await openEntityActions(page);
  await expect(page.getByTestId('visibility-toggle')).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');

  // In the browser it counts under the Private facet, not Shared.
  await page.getByRole('link', { name: 'Library' }).click();
  await page.getByTestId('facet-visibility-private').click();
  await expect(page.getByTestId(`open-${id}`)).toBeVisible();
  // Clear the filter, reopen, and reveal it from the actions menu: the item flips to shared.
  await page.getByTestId('facet-visibility-private').click();
  await page.getByTestId(`open-${id}`).click();
  await openEntityActions(page);
  await page.getByTestId('visibility-toggle').click();
  await openEntityActions(page);
  await expect(page.getByTestId('visibility-toggle')).toHaveAttribute('aria-checked', 'true');

  // The access-scoped Visibility facet now lists it under Shared instead.
  await page.getByRole('link', { name: 'Library' }).click();
  await page.getByTestId('facet-visibility-shared').click();
  await expect(page.getByTestId(`open-${id}`)).toBeVisible();
});

test('creating a map opens the map editor, not the note view', async ({ page }) => {
  await enterLibrary(page);

  await createEntity(page, 'core.type.hex-map');

  // Editor chrome present (harmonized header — ADR-0022).
  await expect(page.getByTestId('title')).toBeVisible();

  // App navigation lives in the rail now (ADR-0022): Library returns to the browser.
  await page.getByRole('link', { name: 'Library' }).click();
  await expect(page).toHaveURL(/\/entities$/);
});

// A real 1×1 PNG — enough for the mint to wrap it in an Asset Entity; no Stats are read here.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * The hidden-from-default-listing exclusion (ADR-0065) at the surface it exists for. An Asset shares its
 * name with the Entity it illustrates, so the search box was where the exclusion used to come undone.
 */
test('the browser’s search box keeps Assets out of the listing; the type facet opts them in', async ({ page }) => {
  const worldId = idFromSegment(await enterLibrary(page));

  // An Asset and an ordinary Entity that answer the same search term.
  const uploaded = await page.request.post(`/api/worlds/${worldId}/assets`, {
    multipart: { file: { name: 'Aldermoor.png', mimeType: 'image/png', buffer: PNG } },
  });
  expect(uploaded.ok(), `${uploaded.status()} ${await uploaded.text()}`).toBeTruthy();
  const assetId = (await uploaded.json()).id as string;
  const created = await page.request.post('/api/entities', {
    data: { name: 'Aldermoor Keep', types: ['core.type.note'], worldId },
  });
  expect(created.ok(), `${created.status()} ${await created.text()}`).toBeTruthy();
  const noteId = (await created.json()).id as string;

  // Default listing: the note, never the Asset.
  await page.reload();
  await expect(page.getByTestId(`open-${noteId}`)).toBeVisible();
  await expect(page.getByTestId(`open-${assetId}`)).toHaveCount(0);

  // Searching the shared name keeps it that way — the search box is part of the listing.
  await page.getByTestId('entity-search').fill('aldermoor');
  await expect(page.getByTestId(`open-${noteId}`)).toBeVisible();
  await expect(page.getByTestId(`open-${assetId}`)).toHaveCount(0);

  // The type facet is the opt-in surface: it counts the Asset all along, and selecting it lists it.
  await page.getByTestId('facet-type-core.type.asset').click();
  await expect(page.getByTestId(`open-${assetId}`)).toBeVisible();
  await expect(page.getByTestId(`open-${noteId}`)).toHaveCount(0);
});
