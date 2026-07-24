import { enterLibrary, entityIdFromUrl, expect, flushSave, test } from './fixtures';

/** The Link Descriptor journey (issue #96, ADR-0023/0035). */
test('characterises a Content Entity Link via :: , persists the descriptor, and reloads as Name (descriptor)', async ({
  page,
  request,
}) => {
  await enterLibrary(page);
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const targetId = entityIdFromUrl(page);

  await enterLibrary(page);
  await page.getByTestId('new-default-entity').click();
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
  expect(JSON.stringify((await res.json()).document['core.field.content'].snapshot)).toContain('spouse');
  const vocab = await (await request.get('/api/entities/descriptors')).json();
  expect(vocab).toContain('spouse');

  await expect(page.getByTestId('entity-link')).toHaveText('Untitled note');
  await expect(page.getByTestId('link-descriptor')).toHaveText('spouse');
});
