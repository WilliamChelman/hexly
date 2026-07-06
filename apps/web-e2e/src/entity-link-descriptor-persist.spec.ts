import { enterLibrary, entityIdFromUrl, expect, flushSave, test } from './fixtures';

/**
 * The Link Descriptor journey (issue #96, ADR-0023): an author characterises a Content
 * Entity Link with a free-text descriptor via the `::` trigger, and it survives a save +
 * reload, rendering the target's live name with the descriptor as a corner badge. Crosses every
 * seam: the `::` suggestion arming only after a link, the descriptor picker's free-text
 * entry, the versioned save, the server harvesting the descriptor from the saved Content
 * into its index (#96, ADR-0035), and an API read of the opaque snapshot (ADR-0009/0019).
 * Prior art: entity-link-content-persist.spec.ts (the `@` link itself).
 */
test('characterises a Content Entity Link via :: , persists the descriptor, and reloads as Name (descriptor)', async ({
  page,
  request,
}) => {
  await enterLibrary(page);
  await page.getByTestId('new-note').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const targetId = entityIdFromUrl(page);

  await enterLibrary(page);
  await page.getByTestId('new-note').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const sourceId = entityIdFromUrl(page);

  // The cursor sits right after link insert, which is exactly where :: arms.
  const surface = page.getByTestId('note-content');
  await surface.click();
  await page.keyboard.type('Married to ');
  await page.keyboard.type('@');
  await expect(page.getByTestId('entity-picker')).toBeVisible();
  await page.getByTestId(`entity-picker-option-${targetId}`).click();

  await page.keyboard.type('::');
  await expect(page.getByTestId('descriptor-picker')).toBeVisible();
  await page.keyboard.type('spouse');
  await page.getByTestId('descriptor-picker-option-spouse').click();

  const link = page.getByTestId('entity-link');
  await expect(link).toHaveText('Untitled note');
  await expect(page.getByTestId('link-descriptor')).toHaveText('spouse');

  await flushSave(page);

  // The persisted snapshot carries the descriptor; the server indexed it for suggestions.
  await page.reload();
  const res = await request.get(`/api/entities/${sourceId}`);
  expect(JSON.stringify((await res.json()).document.content.snapshot)).toContain('spouse');
  const vocab = await (await request.get('/api/entities/descriptors')).json();
  expect(vocab).toContain('spouse');

  await expect(page.getByTestId('entity-link')).toHaveText('Untitled note');
  await expect(page.getByTestId('link-descriptor')).toHaveText('spouse');
});
