import { attachField, createEntity, enterLibrary, expect, flushSave, test } from './fixtures';
import { idFromSegment } from '../../../libs/web-core/src/utils/pretty-id';

/** The canonical Thumbnail Field — an entityLink to an image Asset, attach-on-demand (ADR-0066). */
const THUMBNAIL_FIELD = 'core.field.thumbnail';

// A real 20×8 solid-color PNG: minting it runs sharp, so the Asset gets image Stats and a real
// thumbnail (a WebP beside the bytes) the card can resolve and render.
const PNG_20x8 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABQAAAAICAIAAAB2/0i6AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFUlEQVQYlWOwyTtBNmIY1XxiiAQYACBM50E1XKcYAAAAAElFTkSuQmCC',
  'base64',
);

/**
 * The Thumbnail Field, end to end over the real single-origin build (ADR-0009, ADR-0066, #291): a
 * worldbuilder attaches `core.field.thumbnail` to a plain Note, uploads an image *in place* through the
 * pick-or-upload control (#288) — never a detour through the Asset Browser — saves, and sees that image
 * stand in for the Note on its Entity Browser card (#287). The reload proves it crosses the seam: the
 * designation persists, the write-time derivation materialises it, and the list's `thumbnails=1` read
 * resolves it back to a served URL.
 */
test('attaches the Thumbnail Field, uploads an image in place, and sees it on the note card', async ({ page }) => {
  const prettyWorld = await enterLibrary(page);
  const worldId = idFromSegment(prettyWorld); // the raw id the served asset URL keys on

  const noteId = await createEntity(page, 'core.type.note');
  await expect(page.getByTestId('title')).toBeVisible();

  // Attach the canonical Thumbnail Field — a Field the note's type never declared — the attach-on-demand
  // layer (ADR-0054/0057), through the Details Panel's inline management where its control now lives (ADR-0067).
  await attachField(page, THUMBNAIL_FIELD);

  // The asset-targeting entityLink renders the pick-or-upload affordance, not the plain search picker (#288).
  const control = page.getByTestId(`detail-field-${THUMBNAIL_FIELD}`);
  await control.getByTestId('asset-link-open').click();

  // Upload an image in place: mints an Asset via the ordinary path and stores its wrapper's id as the link.
  await control.getByTestId('asset-link-upload').setInputFiles({
    name: 'crest.png',
    mimeType: 'image/png',
    buffer: PNG_20x8,
  });

  // The panel closes and the current value resolves to a preview tile (thumbnails=1), proving the pick landed.
  await expect(control.getByTestId('asset-link-preview')).toBeVisible();

  // Save flushes the designation into the one EntityDocument map under the Field's key (ADR-0056/0057).
  const saved = await flushSave(page);
  const body = await saved.json();
  expect(body.document[THUMBNAIL_FIELD]).toMatchObject({ entityId: expect.any(String) });

  // Back in the Entity Browser, the note's card resolves the Thumbnail to a served URL (#287): the list
  // opts into thumbnails=1, the write-time derivation materialised the designation, and the reload proves
  // the whole round trip persisted rather than a live in-memory value.
  await page.getByRole('link', { name: 'Library' }).click();
  await page.waitForURL(/\/w\/[\w-]+\/entities$/);
  await page.reload();

  const thumb = page.getByTestId(`thumbnail-${noteId}`);
  await expect(thumb).toBeVisible();
  await expect(thumb).toHaveAttribute('src', new RegExp(`/assets/${worldId}/[0-9a-f]{64}\\.thumb\\.webp$`));
});
