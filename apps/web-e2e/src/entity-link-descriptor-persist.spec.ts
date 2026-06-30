import { enterLibrary, expect, flushSave, quarantineSlice5, test } from './fixtures';

/**
 * The Link Descriptor journey (issue #96, ADR-0023): an author characterises a Content
 * Entity Link with a free-text descriptor via the `::` trigger, and it survives a save +
 * reload, rendering as `Name (descriptor)` with the target's live name. Crosses every
 * seam: the `::` suggestion arming only after a link, the descriptor picker's free-text
 * entry, the client-harvested descriptors riding a versioned save, the server's
 * descriptor index, and an API read of the opaque snapshot (ADR-0009/0019).
 * Prior art: entity-link-content-persist.spec.ts (the `@` link itself).
 */
test('characterises a Content Entity Link via :: , persists the descriptor, and reloads as Name (descriptor)', async ({
  page,
  request,
}) => {
  quarantineSlice5();
  // Seed the link target.
  await enterLibrary(page);
  await page.getByTestId('new-note').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const targetId = page.url().split('/').pop();

  // The source note that will carry the characterised link.
  await enterLibrary(page);
  await page.getByTestId('new-note').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const sourceId = page.url().split('/').pop();

  // Insert the link via @, then characterise it via :: — the cursor sits right after the
  // link on insert, which is exactly where :: arms.
  const surface = page.getByTestId('note-content');
  await surface.click();
  await page.keyboard.type('Married to ');
  await page.keyboard.type('@');
  await expect(page.getByTestId('entity-picker')).toBeVisible();
  await page.getByTestId(`entity-picker-option-${targetId}`).click();

  // :: arms the descriptor picker (a link precedes the cursor); type a brand-new descriptor.
  await page.keyboard.type('::');
  await expect(page.getByTestId('descriptor-picker')).toBeVisible();
  await page.keyboard.type('spouse');
  await page.getByTestId('descriptor-picker-option-spouse').click();

  // The atom now renders the live name with the descriptor as a parenthetical suffix.
  const link = page.getByTestId('entity-link');
  await expect(link).toHaveText('Untitled note (spouse)');

  await flushSave(page);

  // The persisted snapshot carries the descriptor; the server indexed it for suggestions.
  await page.reload();
  const res = await request.get(`/api/entities/${sourceId}`);
  expect(JSON.stringify((await res.json()).document.content.snapshot)).toContain('spouse');
  const vocab = await (await request.get('/api/entities/descriptors')).json();
  expect(vocab).toContain('spouse');

  // After reload it re-renders as Name (descriptor) with the target's live name.
  await expect(page.getByTestId('entity-link')).toHaveText('Untitled note (spouse)');
});
