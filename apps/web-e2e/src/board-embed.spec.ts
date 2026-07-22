import { contentViewToggle, enterLibrary, entityIdFromUrl, expect, flushSave, openEntity, test } from './fixtures';
import { idFromSegment } from '../../../libs/web-core/src/utils/pretty-id';

// A real 20×8 solid-color PNG for minting an image Asset to embed (ADR-0065).
const PNG_20x8 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABQAAAAICAIAAAB2/0i6AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFUlEQVQYlWOwyTtBNmIY1XxiiAQYACBM50E1XKcYAAAAAElFTkSuQmCC',
  'base64',
);

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

/**
 * A Board Embed of an **Asset** renders the Asset's View by transclusion (ADR-0065, #276): a future PDF/audio
 * kind lands on a Board with zero new machinery, and an image draws inline through the same Entity View Outlet
 * the Note embed uses. Confirms the Asset's default View (`''` selects it) resolves and renders inside an Embed.
 */
test('a Board Embed of an image Asset renders its image View by transclusion', async ({ page }) => {
  const worldId = idFromSegment(await enterLibrary(page)); // the raw id the API keys on, decoded from the pretty segment

  // Mint the Asset through the ordinary upload path (ADR-0065); it returns the wrapper Entity to embed.
  const uploaded = await page.request.post(`/api/worlds/${worldId}/assets`, {
    multipart: { file: { name: 'sigil.png', mimeType: 'image/png', buffer: PNG_20x8 } },
  });
  expect(uploaded.ok(), `${uploaded.status()} ${await uploaded.text()}`).toBeTruthy();
  const assetId = (await uploaded.json()).id as string;

  // A Board embedding the Asset through its default View (`viewInstance: ''`), seeded over the API.
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
              targetEntityId: assetId,
              viewInstance: '', // the Asset's default View — the mime-dispatching Asset renderer
            },
          ],
        },
      },
    },
  });
  expect(created.ok(), `${created.status()} ${await created.text()}`).toBeTruthy();
  const boardId = (await created.json()).id as string;

  await openEntity(page, boardId);

  // The Embed mounts the Asset View, which draws the image inline (the transclusion the ticket asks for).
  const embeddedImage = page.locator('app-board-embed [data-testid="asset-image"]');
  await expect(embeddedImage).toBeVisible();
});
