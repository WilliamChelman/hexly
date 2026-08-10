import type { Page } from '@playwright/test';
import { enterEntities, entitiesNamed, entityIdFromUrl, expect, test } from './fixtures';

/**
 * Inline Creation's details path (issue #344, ADR-0073): `Create "…" with details…` opens the ordinary
 * create dialog and returns the author to their prose.
 *
 * End-to-end because the suggestion range dies at `onExit` the instant the popup closes — seconds before
 * the dialog resolves — so only driving the real modal proves the captured range outlived it.
 */

/** Type an `@` mention and wait for the rows to catch up with the whole query before acting on them. */
async function mention(page: Page, query: string): Promise<void> {
  await page.keyboard.type(`@${query}`);
  await expect(page.getByTestId('entity-picker-create-details')).toHaveText(`Create "${query}" with details…`);
  // The arrow keys below count rows, so a match would move the details row out from under them and
  // Enter would mint silently instead. Fail here, where the reason is legible.
  await expect(page.getByTestId('entity-picker').getByRole('option')).toHaveCount(2);
}

/** Open a fresh note and put the caret in its prose. */
async function openNote(page: Page): Promise<string> {
  await enterEntities(page);
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  await page.getByTestId('note-content').click();
  return entityIdFromUrl(page);
}

test('the details row sits below the plain Create row and is reached by the same arrow keys', async ({ page }) => {
  await openNote(page);
  await mention(page, 'Zorblax');

  // Nothing matches, so the two Create rows are the whole listbox — plain first, details below it.
  const rows = page.getByTestId('entity-picker').getByRole('option');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toHaveAttribute('data-testid', 'entity-picker-create');
  await expect(rows.nth(1)).toHaveAttribute('data-testid', 'entity-picker-create-details');

  // The fast path is what Enter reaches; the details row is one ArrowDown away.
  await expect(rows.nth(0)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true');
});

test('submitting inserts the link where the mention was typed and leaves the author in the editor', async ({
  page,
  request,
}) => {
  const hostId = await openNote(page);
  const host = await (await request.get(`/api/entities/${hostId}`)).json();
  const url = page.url();

  // The mention is typed *mid-sentence*, so a link that lands under the caret rather than at the
  // captured point would land in the wrong half of the prose.
  const tail = ' and the wardens.';
  await page.keyboard.type(`Feared by ${tail}`);
  for (let i = 0; i < tail.length; i++) await page.keyboard.press('ArrowLeft');
  await mention(page, 'Zorblax');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');

  // The dialog opens prefilled with the typed name, on the host Entity's World, which it cannot change:
  // the details path must not do what the fast path forbids.
  await expect(page.getByTestId('create-entity-name')).toHaveValue('Zorblax');
  const world = page.getByTestId('create-entity-world');
  await expect(world).toBeDisabled();
  await expect(world).toHaveValue(host.worldId);

  await page.getByTestId('create-entity-submit').click();

  const link = page.getByTestId('entity-link');
  await expect(link).toHaveText('Zorblax');
  const surface = page.getByTestId('note-content');
  await expect(surface).toContainText(/Feared by\s*Zorblax\s*and the wardens\./);

  // Creating mid-sentence leaves you where you were writing: the URL never moved.
  await expect(page).toHaveURL(url);

  const minted = await (await request.get(`/api/entities/${await link.getAttribute('data-entity-id')}`)).json();
  expect(minted.name).toBe('Zorblax');
  expect(minted.worldId).toBe(host.worldId);
});

test('the Types and Tags set in the dialog land on the created Entity', async ({ page, request }) => {
  await openNote(page);
  await mention(page, 'Zorblax');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');

  // The point of asking for the dialog: say what the thing is before it exists. The manager's typeahead
  // opens on focus; pick the hexmap option.
  await page.getByTestId('type-add').click();
  await page.getByTestId('type-option-core.type.hex-map').click();
  await page.getByTestId('create-entity-tag-input').fill('rival');
  await page.getByTestId('create-entity-tag-input').press('Enter');
  await expect(page.getByTestId('create-tag-remove-rival')).toBeVisible();
  await page.getByTestId('create-entity-submit').click();

  const link = page.getByTestId('entity-link');
  await expect(link).toHaveText('Zorblax');

  const minted = await (await request.get(`/api/entities/${await link.getAttribute('data-entity-id')}`)).json();
  expect(minted.types).toEqual(['core.type.note', 'core.type.hex-map']);
  expect(minted.tags).toEqual(['rival']);
});

test('a Link Descriptor typed alongside the mention survives the dialog onto the link', async ({ page }) => {
  await openNote(page);
  await page.keyboard.type('@Zorblax::rival');
  await expect(page.getByTestId('entity-picker-create-details')).toHaveText('Create "Zorblax" with details…');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.getByTestId('create-entity-submit').click();

  await expect(page.getByTestId('entity-link')).toHaveText('Zorblax');
  await expect(page.getByTestId('link-descriptor')).toHaveText('rival');
});

test('cancelling after /link removes the @ the slash item inserted, exactly as Esc would', async ({ page }) => {
  await openNote(page);
  await page.keyboard.type('Feared by /link');
  await page.getByTestId('slash-item-link').click();
  // The slash item inserted the `@` itself; only the name is typed here.
  await page.keyboard.type('Zorblax');
  await expect(page.getByTestId('entity-picker-create-details')).toHaveText('Create "Zorblax" with details…');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.getByTestId('create-entity-cancel').click();

  // The `@` was ours, so it goes; the name the author typed after it goes with it, as at the picker.
  await expect(page.getByTestId('note-content')).not.toContainText('@');
  await expect(page.getByTestId('entity-link')).toHaveCount(0);
});

test('cancelling leaves the typed text in the prose and creates nothing', async ({ page, request }) => {
  await openNote(page);
  await page.keyboard.type('Feared by ');
  await mention(page, 'Zorblax');

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('create-entity-name')).toHaveValue('Zorblax');

  await page.getByTestId('create-entity-cancel').click();

  // We clean up what we inserted, never what you typed — cancelling reads exactly like Esc at the picker.
  await expect(page.getByTestId('note-content')).toContainText('Feared by @Zorblax');
  await expect(page.getByTestId('entity-link')).toHaveCount(0);
  expect(await entitiesNamed(request, 'Zorblax')).toHaveLength(0);
});
