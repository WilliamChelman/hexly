import { authToken, enterLibrary, expect, flushSave, readEntity, test } from './fixtures';

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
  // Seed the link target.
  await enterLibrary(page);
  await page.getByTestId('new-note').click();
  await expect(page).toHaveURL(/\/entities\/[^/]+$/);
  const targetId = page.url().split('/').pop();

  // The source note that will carry the characterised link.
  await enterLibrary(page);
  await page.getByTestId('new-note').click();
  await expect(page).toHaveURL(/\/entities\/[^/]+$/);
  const sourceId = page.url().split('/').pop();

  // Insert the link via @, then characterise it via :: — the cursor sits right after the
  // link on insert, which is exactly where :: arms.
  const surface = page.getByTestId('note-content');
  await surface.click();
  await page.keyboard.type('Married to ');
  await page.keyboard.type('@');
  await expect(page.getByTestId('entity-picker')).toBeVisible();
  // The URL segment is percent-encoded (the base64 id's `==` padding → `%3D%3D`); the
  // option's data-testid carries the raw wire id, so decode to match.
  await page.getByTestId(`entity-picker-option-${decodeURIComponent(targetId!)}`).click();

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
  const { document } = await readEntity(page, request, sourceId!);
  expect(JSON.stringify(document.content.snapshot)).toContain('spouse');
  // The descriptor index (#132): an independent read of the entity_descriptors Record API
  // returns the owner's harvested vocabulary — exactly what `::` suggests. The AFTER UPDATE
  // trigger populated it from the descriptors the save carried.
  const indexRes = await request.get('/api/records/v1/entity_descriptors', {
    headers: { authorization: `Bearer ${await authToken(page)}` },
  });
  const vocab = ((await indexRes.json()).records as { descriptor: string }[]).map((r) => r.descriptor);
  expect(vocab).toContain('spouse');

  // After reload it re-renders as Name (descriptor) with the target's live name.
  await expect(page.getByTestId('entity-link')).toHaveText('Untitled note (spouse)');
});

test('the `::` picker type-aheads a previously-saved descriptor by prefix (#132)', async ({ page }) => {
  // A note to link to from both source notes.
  await enterLibrary(page);
  await page.getByTestId('new-note').click();
  await expect(page).toHaveURL(/\/entities\/[^/]+$/);
  const targetWireId = decodeURIComponent(page.url().split('/').pop()!);

  // Helper: in the open note, insert a link to the target via @.
  const linkTarget = async () => {
    await page.getByTestId('note-content').click();
    await page.keyboard.type('@');
    await expect(page.getByTestId('entity-picker')).toBeVisible();
    await page.getByTestId(`entity-picker-option-${targetWireId}`).click();
  };

  // Source 1: characterise the link with 'spouse' and save — this seeds the World vocabulary.
  await enterLibrary(page);
  await page.getByTestId('new-note').click();
  await expect(page).toHaveURL(/\/entities\/[^/]+$/);
  await linkTarget();
  await page.keyboard.type('::spouse');
  await page.getByTestId('descriptor-picker-option-spouse').click();
  await flushSave(page);

  // Source 2: a different note. Typing `::sp` queries the server and offers the saved
  // 'spouse' as an existing suggestion — on-the-fly type-ahead, not just the typed free text.
  await enterLibrary(page);
  await page.getByTestId('new-note').click();
  await expect(page).toHaveURL(/\/entities\/[^/]+$/);
  await linkTarget();
  await page.keyboard.type('::sp');
  await expect(page.getByTestId('descriptor-picker')).toBeVisible();
  await expect(page.getByTestId('descriptor-picker-option-spouse')).toBeVisible();
});
