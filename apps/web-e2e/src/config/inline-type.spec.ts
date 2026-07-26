import { enterLibrary, expect, test } from '../fixtures';

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
