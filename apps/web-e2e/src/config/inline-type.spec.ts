import { strToU8, zipSync } from 'fflate';
import { enterLibrary, expect, importUnresolvedVault, test } from '../fixtures';

/**
 * `entities.inlineType: core.type.hex-map` + `entities.inlineTag: untriaged`, with `defaultType` left on
 * its own default — via its own server (ADR-0052, Seam 4; server in `playwright.config.ts`). The two
 * knobs answer different questions (ADR-0073), so this run proves Inline Creation follows its own.
 */

test('a mention mints under entities.inlineType and entities.inlineTag, not the New button’s Type', async ({
  page,
  request,
}) => {
  const config = await (await request.get('/api/config')).json();
  expect(config.entities.inlineType).toBe('core.type.hex-map');
  expect(config.entities.inlineTag).toBe('untriaged');
  expect(config.entities.defaultType).toBe('core.type.note');

  await enterLibrary(page);
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);

  await page.getByTestId('note-content').click();
  await page.keyboard.type('@Zorblax');
  await expect(page.getByTestId('entity-picker-create')).toBeVisible();
  await page.keyboard.press('Enter');

  const link = page.getByTestId('entity-link');
  await expect(link).toHaveText('Zorblax');

  const minted = await (await request.get(`/api/entities/${await link.getAttribute('data-entity-id')}`)).json();
  expect(minted.types).toEqual(['core.type.hex-map']);
  expect(minted.tags).toEqual(['untriaged']);
});

test('the vault import dialog opens prefilled with the same inline Type and Tag (#347)', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('import-vault-input').setInputFiles({
    name: 'Aldermoor.zip',
    mimeType: 'application/zip',
    // A one-note vault: the dialog is what this asserts, not what the import lands.
    buffer: Buffer.from(zipSync({ 'Keep.md': strToU8('Held against [[Zorblax]].') })),
  });

  // The import's overrides are seeded from the Instance's Inline Creation knobs, not `defaultType` —
  // an import mints by the hundred, so it must follow the same knob a mention does (ADR-0073).
  await expect(page.getByTestId('import-options')).toBeVisible();
  await expect(page.getByTestId('import-create-unresolved')).toBeChecked();
  await expect(page.getByTestId('import-inline-type')).toHaveValue('core.type.hex-map');
  await expect(page.getByTestId('import-inline-tag')).toHaveValue('untriaged');
});

test('the details dialog opens prefilled with the same inline Type and Tag (#344)', async ({ page, request }) => {
  await enterLibrary(page);
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);

  await page.getByTestId('note-content').click();
  await page.keyboard.type('@Zorblax');
  await expect(page.getByTestId('entity-picker-create-details')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');

  // The details path asks the same two knobs the fast path does — it only lets the author change them.
  await expect(page.getByTestId('type-chip-core.type.hex-map')).toBeVisible();
  await expect(page.getByTestId('create-tag-remove-untriaged')).toBeVisible();

  await page.getByTestId('create-entity-submit').click();

  const link = page.getByTestId('entity-link');
  await expect(link).toHaveText('Zorblax');
  const minted = await (await request.get(`/api/entities/${await link.getAttribute('data-entity-id')}`)).json();
  expect(minted.types).toEqual(['core.type.hex-map']);
  expect(minted.tags).toEqual(['untriaged']);
});

test('promoting an Unresolved Link mints under the same inline Type and Tag (#350)', async ({ page, request }) => {
  // Landed with auto-creation off, so the wikilink stays the Unresolved Link this promotes.
  await importUnresolvedVault(page);

  const link = page.getByTestId('entity-link');
  await expect(link).toHaveAttribute('data-unresolved', '');
  await link.click();
  await page.getByTestId('entity-link-repair-create').click();

  // Promotion is Inline Creation, so it follows the same two knobs a mention does, not `defaultType`.
  await expect(link).toHaveAttribute('data-entity-id', /.+/);
  const minted = await (await request.get(`/api/entities/${await link.getAttribute('data-entity-id')}`)).json();
  expect(minted.name).toBe('Zorblax');
  expect(minted.types).toEqual(['core.type.hex-map']);
  expect(minted.tags).toEqual(['untriaged']);
});
