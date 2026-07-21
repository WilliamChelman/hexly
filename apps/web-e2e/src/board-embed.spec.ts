import { contentViewToggle, enterLibrary, entityIdFromUrl, expect, flushSave, openEntity, test } from './fixtures';

/**
 * Board Embed transclusion (ADR-0062, #270): an Embed element renders its target Entity's chosen View
 * inline. This guards the regression where the embedded body rendered **empty** — a Note target's prose
 * View is placed by id (no Field key), so the Embed's Outlet did not provide `VIEW_FIELD_KEY`, and the
 * nested Content editor inherited the *Board's* surface Field key from the enclosing view's injector
 * instead of falling back to the canonical `core.field.content`. The editor then read the wrong document
 * slot and seeded nothing, though the target's own page (no enclosing Board) rendered the prose fine.
 */
test('a Board Embed of a Note renders the target’s prose, not an empty body', async ({ page }) => {
  await enterLibrary(page);

  // A real Note with prose, authored through the editor and saved (opaque snapshot, ADR-0019).
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const noteId = entityIdFromUrl(page);
  const prose = 'Bigby Bakersville lives in the north.';
  await page.getByTestId('note-content').click();
  await page.keyboard.type(prose);
  await flushSave(page);

  // A Board that embeds the Note through its prose View, pinned by the bare `core.view.rich-content` key
  // — the shape a Note's by-id placement affords (no `:fieldKey` segment). Seeded over the API so the
  // Embed element lands without driving the on-canvas Embed Tool.
  const created = await page.request.post('/api/entities', {
    data: {
      name: 'Untitled board',
      types: ['core.type.board'],
      document: {
        'core.field.surface': {
          elements: [
            {
              id: 'embed-1',
              kind: 'embed',
              position: { x: 0, y: 0 },
              size: { width: 480, height: 360 },
              z: 0,
              targetEntityId: noteId,
              viewInstance: contentViewToggle(), // bare `core.view.rich-content`
            },
          ],
        },
      },
    },
  });
  expect(created.ok(), `${created.status()} ${await created.text()}`).toBeTruthy();
  const boardId = (await created.json()).id as string;

  await openEntity(page, boardId);

  // The Embed mounts the Content View and seeds the target's prose — the assertion the empty-body bug fails.
  const embeddedBody = page.locator('app-board-embed [data-testid="note-content"]');
  await expect(embeddedBody).toContainText(prose);
});
