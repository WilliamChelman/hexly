import type { Page } from '@playwright/test';
import { enterLibrary, entityIdFromUrl, expect, flushSave, segRe, test } from './fixtures';

/**
 * Inline Creation (issue #343, ADR-0073): `@` plus a name nothing matches creates the Entity and links
 * it without leaving the sentence. Follows the entity-link and descriptor persist specs.
 */

/**
 * Type an `@` mention and wait for the picker to settle on the *whole* query — the rows lag the
 * keystrokes by a debounced server search, and Enter before they land would type a newline.
 */
async function mention(page: Page, query: string, name = query): Promise<void> {
  await page.keyboard.type(`@${query}`);
  await expect(page.getByTestId('entity-picker')).toBeVisible();
  await expect(page.getByTestId('entity-picker-create')).toHaveText(`Create "${name}"`);
}

test('mints the Entity an unmatched mention names, links it, and keeps the author in the sentence', async ({
  page,
  request,
}) => {
  await enterLibrary(page);
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const hostId = entityIdFromUrl(page);

  const surface = page.getByTestId('note-content');
  await surface.click();
  await page.keyboard.type('Feared by ');
  // The Link Descriptor rides along with the mention; the `::` picker only arms after a link exists.
  await mention(page, 'Zorblax::rival', 'Zorblax');

  await page.keyboard.press('Enter');

  const link = page.getByTestId('entity-link');
  await expect(link).toHaveText('Zorblax');
  await expect(page.getByTestId('link-descriptor')).toHaveText('rival');

  // Focus never left the prose: the next keystrokes land after the link, in the sentence being written.
  // The descriptor badge renders inside the link, hence the gap in the middle.
  await page.keyboard.type(' and the wardens.');
  await expect(surface).toContainText(/Feared by\s*Zorblax[\s\S]*and the wardens\./);

  const zorblaxId = await link.getAttribute('data-entity-id');
  expect(zorblaxId).toBeTruthy();

  // An ordinary Entity, of the configured inline Type, in the World it was named from — typing must
  // never author a cross-World link.
  const host = await (await request.get(`/api/entities/${hostId}`)).json();
  const detail = await (await request.get(`/api/entities/${zorblaxId}`)).json();
  expect(detail.name).toBe('Zorblax');
  expect(detail.types).toEqual(['core.type.note']);
  expect(detail.worldId).toBe(host.worldId);

  await flushSave(page);
  await page.reload();

  // The descriptor persisted onto the minted link, and the link is followable.
  const stored = await (await request.get(`/api/entities/${hostId}`)).json();
  expect(JSON.stringify(stored.document['core.field.content'].snapshot)).toContain('rival');
  await expect(page.getByTestId('link-descriptor')).toHaveText('rival');
  await page.getByTestId('entity-link').click();
  await expect(page).toHaveURL(new RegExp(`/entities/${segRe(zorblaxId!)}$`));
});

test('keeps writing across the round trip: the link lands where it was typed, not under the caret', async ({
  page,
}) => {
  await enterLibrary(page);
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);

  // Hold the create in flight so the author demonstrably writes past the mention before it lands.
  await page.route(
    (url) => url.pathname === '/api/entities',
    async (route) => {
      if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    },
  );

  const surface = page.getByTestId('note-content');
  await surface.click();
  await page.keyboard.type('Feared by ');
  await mention(page, 'Zorblax');
  await page.keyboard.press('Enter');
  await page.keyboard.type('and the wardens.');

  await expect(page.getByTestId('entity-link')).toHaveText('Zorblax');
  await expect(surface).toContainText(/Feared by\s*Zorblax\s*and the wardens\./);
});

test('offers Create beside the matches, and a second mention offers the Entity the first one minted', async ({
  page,
}) => {
  await enterLibrary(page);
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);

  const surface = page.getByTestId('note-content');
  await surface.click();
  await mention(page, 'Zorblax');
  await page.keyboard.press('Enter');
  const first = page.getByTestId('entity-link').first();
  await expect(first).toHaveText('Zorblax');
  const firstId = await first.getAttribute('data-entity-id');

  // Typing the same name again: the minted Entity is now an ordinary match — two mentions converge.
  await page.keyboard.type(' met ');
  await mention(page, 'Zorblax');
  await expect(page.getByTestId(`entity-picker-option-${firstId}`)).toBeVisible();
  // …and Create is still offered, so a second, different Zorblax is authorable.
  await expect(page.getByTestId('entity-picker-create')).toBeVisible();

  // Reached by the same arrow keys as any row: ArrowUp wraps onto Create, which is always last.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('entity-link')).toHaveCount(2);
  const secondId = await page.getByTestId('entity-link').nth(1).getAttribute('data-entity-id');
  expect(secondId).not.toBe(firstId);
});

test('Esc at the picker leaves the typed name as plain prose and creates nothing', async ({ page, request }) => {
  await enterLibrary(page);
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);

  const surface = page.getByTestId('note-content');
  await surface.click();

  // A bare `@` names nothing, so there is nothing to mint and no Create row.
  await page.keyboard.type('@');
  await expect(page.getByTestId('entity-picker')).toBeVisible();
  await expect(page.getByTestId('entity-picker-create')).toHaveCount(0);

  await page.keyboard.type('Zorblax');
  await expect(page.getByTestId('entity-picker-create')).toHaveText('Create "Zorblax"');
  await page.keyboard.press('Escape');

  await expect(page.getByTestId('entity-picker')).toBeHidden();
  await expect(surface).toContainText('@Zorblax');
  await expect(page.getByTestId('entity-link')).toHaveCount(0);

  const found = await (await request.get('/api/entities?q=Zorblax')).json();
  expect(found.items).toHaveLength(0);
});
