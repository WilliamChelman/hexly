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

/** Hold every `POST /api/entities` for `ms`, so the author demonstrably acts while the mint is out. */
async function holdCreates(page: Page, ms: number): Promise<void> {
  await page.route(
    (url) => url.pathname === '/api/entities',
    async (route) => {
      if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, ms));
      await route.continue();
    },
  );
}

/** Resolve once the create the author asked for has come back. */
function createLanded(page: Page): Promise<unknown> {
  return page.waitForResponse((res) => res.request().method() === 'POST' && res.url().endsWith('/api/entities'));
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
  await holdCreates(page, 800);

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

  // Reached by the same arrow keys as any row: Create sits directly below the matches (#344 added the
  // details row below it, so it is no longer last).
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('entity-link')).toHaveCount(2);
  const secondId = await page.getByTestId('entity-link').nth(1).getAttribute('data-entity-id');
  expect(secondId).not.toBe(firstId);
});

test('a failed write puts the typed text back, exactly as it was typed', async ({ page }) => {
  await enterLibrary(page);
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);

  await page.route(
    (url) => url.pathname === '/api/entities',
    async (route) => {
      if (route.request().method() === 'POST') return route.fulfill({ status: 500, body: '{}' });
      return route.continue();
    },
  );

  const surface = page.getByTestId('note-content');
  await surface.click();
  await page.keyboard.type('Feared by ');
  // A name shaped like markup: the restore must be a literal text insert, not a parse.
  await mention(page, 'Ser <b>Bob</b> Kensington');
  await page.keyboard.press('Enter');

  await expect(page.locator('.toast', { hasText: 'Could not create the entity' })).toBeVisible();
  await expect(surface).toContainText('Feared by @Ser <b>Bob</b> Kensington');
  await expect(page.getByTestId('entity-link')).toHaveCount(0);
});

test('undo while the mint is in flight retracts the mention rather than doubling the text', async ({ page }) => {
  await enterLibrary(page);
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  await holdCreates(page, 1500);

  const surface = page.getByTestId('note-content');
  await surface.click();
  await mention(page, 'Zorblax');
  // Reading the rows before choosing closes the history event, so the deletion is undoable on its own —
  // which is what makes a mid-flight Ctrl-Z able to put the typed text back under the pending link.
  await page.waitForTimeout(700);
  const landed = createLanded(page);
  await page.keyboard.press('Enter');
  await expect(surface).not.toContainText('@Zorblax');

  await page.keyboard.press('ControlOrMeta+z');
  await expect(surface).toContainText('@Zorblax');

  await landed;
  // The author took it back: no link goes in beside the text they got back, and the prose holds the
  // name exactly once.
  await expect(page.getByTestId('entity-link')).toHaveCount(0);
  await expect(surface).toHaveText('@Zorblax');
});

test('a mint landing after the author moved on leaves their caret where they put it', async ({ page }) => {
  await enterLibrary(page);
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  await holdCreates(page, 1200);

  const surface = page.getByTestId('note-content');
  await surface.click();
  await mention(page, 'Zorblax');
  const landed = createLanded(page);
  await page.keyboard.press('Enter');

  // Off to the Tags field while the write is out — an ordinary thing to do mid-note.
  const tags = page.getByTestId('tag-input');
  await tags.click();
  await page.keyboard.type('riv');
  await landed;
  await expect(page.getByTestId('entity-link')).toHaveText('Zorblax');

  // The rest of the word must land in the field the author is typing in, not in the prose behind it.
  await page.keyboard.type('al');
  await expect(tags).toHaveValue('rival');
  await expect(surface).not.toContainText('al');
});

test('two mentions of one name inside a single round trip converge on one Entity', async ({ page, request }) => {
  await enterLibrary(page);
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  await holdCreates(page, 1500);

  const surface = page.getByTestId('note-content');
  await surface.click();
  await mention(page, 'Zorblax');
  await page.keyboard.press('Enter');
  // The picker still offers Create — the search cache holds the miss until the first mint lands — so
  // nothing tells the author one is already on its way.
  await page.keyboard.type(' met ');
  await mention(page, 'Zorblax');
  await page.keyboard.press('Enter');

  const links = page.getByTestId('entity-link');
  await expect(links).toHaveCount(2);
  const first = await links.nth(0).getAttribute('data-entity-id');
  expect(await links.nth(1).getAttribute('data-entity-id')).toBe(first);

  // One Entity, not two spellings of the same name drifting apart (ADR-0073).
  const found = await (await request.get('/api/entities?q=Zorblax')).json();
  expect(found.items).toHaveLength(1);
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
