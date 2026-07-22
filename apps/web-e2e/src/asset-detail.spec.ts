import { enterLibrary, expect, flushSave, openEntity, test } from './fixtures';
import { idFromSegment } from '../../../libs/web-core/src/utils/pretty-id';

// A real 20×8 solid-color PNG — small enough to inline, big enough for sharp to derive Asset Stats
// (dimensions, orientation, dominant color) at mint (ADR-0065).
const PNG_20x8 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABQAAAAICAIAAAB2/0i6AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFUlEQVQYlWOwyTtBNmIY1XxiiAQYACBM50E1XKcYAAAAAElFTkSuQmCC',
  'base64',
);

/**
 * The Asset detail page (ADR-0065, #276): an Asset's one View renders its bytes (the image renderer for an
 * image), its mechanical Asset Stats, its canonical Content prose, and its usage — all off the ordinary
 * Entity page, since an Asset is an Entity. Proves the View backs the detail page and that prose authored on
 * an Asset persists like any Entity's Content.
 */
test('an image Asset detail page shows the rendered image, its stats, and editable prose', async ({ page }) => {
  const worldId = idFromSegment(await enterLibrary(page)); // the raw id the API keys on, decoded from the pretty segment

  // Mint an Asset by uploading bytes through the ordinary upload path (ADR-0065); it returns the wrapper Entity.
  const uploaded = await page.request.post(`/api/worlds/${worldId}/assets`, {
    multipart: { file: { name: 'sigil.png', mimeType: 'image/png', buffer: PNG_20x8 } },
  });
  expect(uploaded.ok(), `${uploaded.status()} ${await uploaded.text()}`).toBeTruthy();
  const asset = await uploaded.json();

  await openEntity(page, asset.id);

  // The image renderer draws the bytes at their served capability URL (ADR-0034).
  const image = page.getByTestId('asset-image');
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('src', new RegExp(`/assets/${worldId}/[0-9a-f]{64}\\.png$`));

  // The mechanical Asset Stats sharp derived at mint — the 20×8 dimensions confirm extraction ran.
  await expect(page.getByTestId('asset-stat-dimensions')).toContainText('20 × 8');

  // Usage: a fresh Asset is linked from nowhere, so the empty state shows (populated usage is #277's edges).
  await expect(page.getByTestId('asset-usage-empty')).toBeVisible();

  // Prose authored on the Asset's canonical Content persists like any Entity's (ADR-0065).
  const prose = 'Painted by the Guild of Cartographers.';
  await page.getByTestId('note-content').click();
  await page.keyboard.type(prose);
  await flushSave(page);

  await page.reload();
  await expect(page.getByTestId('note-content')).toContainText(prose);
});
