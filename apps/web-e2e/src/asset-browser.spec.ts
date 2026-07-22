import { enterLibrary, expect, openEntity, test } from './fixtures';
import { idFromSegment } from '../../../libs/web-core/src/utils/pretty-id';

// A real 20×8 solid-color PNG: minting it runs sharp, so the Asset gets image Stats (a landscape
// orientation) and the picker's Facet rail has a real image Facet to filter by (ADR-0065).
const PNG_20x8 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABQAAAAICAIAAAB2/0i6AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFUlEQVQYlWOwyTtBNmIY1XxiiAQYACBM50E1XKcYAAAAAElFTkSuQmCC',
  'base64',
);

/**
 * The Board image picker's entity-search flow (ADR-0065, #281): the picker offers the same search + Facets
 * as the Asset Browser, pinned to the asset type + image kind, replacing the old list-everything client
 * filter. This drives the on-canvas Image Tool to open the picker, searches by name, filters by an image
 * Facet, and picks an existing Asset — landing a **capability-URL Image element** (static decor, never armed;
 * distinct from an Embed of an Asset).
 */
test('the Board image picker searches + facets Assets, and picking one lands a capability-URL Image', async ({
  page,
}) => {
  const worldId = idFromSegment(await enterLibrary(page)); // raw id the API keys on, decoded from the pretty segment

  // Mint an image Asset through the ordinary upload path; it returns the wrapper Entity carrying the ref.
  const uploaded = await page.request.post(`/api/worlds/${worldId}/assets`, {
    multipart: { file: { name: 'sigil-art.png', mimeType: 'image/png', buffer: PNG_20x8 } },
  });
  expect(uploaded.ok(), `${uploaded.status()} ${await uploaded.text()}`).toBeTruthy();
  const hash = (await uploaded.json()).document['core.field.asset'].hash as string;

  // A blank Board to place the Image onto, seeded over the API.
  const created = await page.request.post('/api/entities', {
    data: { name: 'Untitled board', types: ['core.type.board'], document: { 'core.field.surface': { elements: [] } } },
  });
  expect(created.ok(), `${created.status()} ${await created.text()}`).toBeTruthy();
  const boardId = (await created.json()).id as string;

  await openEntity(page, boardId);

  // Arm the Image Tool and click the empty canvas — the placement routes through BoardImagePlacement,
  // which opens the picker (a click's pointerdown/up at one point is a placement, not a drag).
  await page.getByTestId('tool-image').click();
  await page.locator('app-board-canvas canvas').click({ position: { x: 200, y: 200 } });

  // The picker offers the entity-search: a name box, an image Facet rail (orientation), and the Asset grid.
  await expect(page.getByTestId('image-search')).toBeVisible();
  const tile = page.getByTestId('image-asset-choice');
  await expect(tile).toHaveCount(1);

  // Filter by the image Facet (the Asset is landscape): it stays in the narrowed set.
  await page.getByTestId('image-facet-orientation-landscape').click();
  await expect(tile).toHaveCount(1);

  // Searching by a non-matching name empties the grid (server FTS, not a client mime filter); clearing brings it back.
  await page.getByTestId('image-search').fill('nonexistent-name-xyz');
  await expect(page.getByTestId('image-empty')).toBeVisible();
  await page.getByTestId('image-search').fill('');
  await expect(tile).toHaveCount(1);

  // Pick the existing Asset — the picker closes and an Image element lands at the served capability URL.
  await tile.click();

  const image = page.locator('app-board-image [data-testid="image-asset"]');
  await expect(image).toBeVisible();
  await expect(image).toHaveAttribute('src', `/assets/${worldId}/${hash}.png`);

  // The Image is lightweight static decor, distinct from an Embed of an Asset — no Embed element is placed.
  await expect(page.locator('app-board-embed')).toHaveCount(0);
});
