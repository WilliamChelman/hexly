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
 * as the Asset Browser, pinned to the asset type + image kind — server-side search, never a client-side
 * mime filter. This drives the on-canvas Image Tool to open the picker, searches by name, filters by an image
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

/**
 * The Asset Browser page (ADR-0065, #282): a World-nav destination presenting the Entity Browser preset to
 * the asset type — a World's uploaded media as thumbnail tiles, with upload at hand and the same search +
 * Facets. This enters via the nav destination, uploads through the header affordance, and drives search +
 * an image Facet, proving the browser is the Entity list pinned to the asset type (the type facet is
 * therefore hidden — it is pinned, never a choice here).
 */
test('the Asset Browser lists uploaded media as thumbnail tiles, with upload, search and Facets', async ({ page }) => {
  const worldId = idFromSegment(await enterLibrary(page)); // raw id the API keys on, decoded from the pretty segment

  // The Asset Browser is a nav destination beside the Library (ADR-0041) — every reader reaches it.
  await page.getByTestId('nav-assets').click();
  await page.waitForURL(/\/w\/[\w-]+\/assets$/);

  // Empty to begin: no media uploaded yet.
  await expect(page.getByTestId('empty')).toBeVisible();

  // Upload through the header affordance — mints an Asset via the ordinary path, then refreshes the grid.
  await page.getByTestId('asset-upload-input').setInputFiles({
    name: 'aurora-banner.png',
    mimeType: 'image/png',
    buffer: PNG_20x8,
  });

  // The upload lands as a thumbnail tile: an <img> at the served thumbnail URL (a WebP beside the bytes).
  const tile = page.locator('[data-testid^="asset-tile-"]');
  await expect(tile).toHaveCount(1);
  await expect(tile.locator('img')).toHaveAttribute(
    'src',
    new RegExp(`/assets/${worldId}/[0-9a-f]{64}\\.thumb\\.webp$`),
  );
  await expect(page.getByText('aurora-banner')).toBeVisible();

  // The type facet is pinned to the asset type, so it never appears as a rail choice here.
  await expect(page.getByTestId('facet-heading-type')).toHaveCount(0);

  // Filter by an image Facet — the 20×8 upload is landscape, so it stays in the narrowed set.
  await page.getByTestId('facet-field-orientation-landscape').click();
  await expect(tile).toHaveCount(1);

  // Search by name: a non-matching query empties the grid (server FTS over the asset type); clearing restores it.
  await page.getByTestId('entity-search').fill('nonexistent-name-xyz');
  await expect(page.getByTestId('no-matches')).toBeVisible();
  await page.getByTestId('entity-search').fill('');
  await expect(tile).toHaveCount(1);
});

/**
 * Assets are ordinary Entities (ADR-0065, #282), so Quick Open matches them by name and the Dashboard can
 * pin one — both free from the Entity model: a hidden-by-default type never hides an Asset from a
 * deliberate name search or an id-resolved pin. This seeds an Asset over the API, finds it in Quick Open,
 * then pins it to the Dashboard and confirms the pinned tile resolves.
 */
test('Quick Open matches an Asset by name and it can be pinned to the World Dashboard', async ({ page }) => {
  const prettyWorld = await enterLibrary(page); // the pretty `slug-base62(id)` segment the URL carries
  const worldId = idFromSegment(prettyWorld); // the raw id the API keys on

  // Mint an Asset with a distinctive name so the FTS match is unambiguous.
  const uploaded = await page.request.post(`/api/worlds/${worldId}/assets`, {
    multipart: { file: { name: 'moonlit-keep.png', mimeType: 'image/png', buffer: PNG_20x8 } },
  });
  expect(uploaded.ok(), `${uploaded.status()} ${await uploaded.text()}`).toBeTruthy();
  const assetId = (await uploaded.json()).id as string;

  // Seed one authored Note so the Dashboard shows its content (its blank-slate hides the pins section, and
  // recents exclude a hidden-by-default Asset). The pinned Asset itself is what we assert below.
  const note = await page.request.post('/api/entities', {
    data: { name: 'Field notes', types: ['core.type.note'], worldId },
  });
  expect(note.ok(), `${note.status()} ${await note.text()}`).toBeTruthy();

  // Quick Open matches the Asset by name — a name search is not a "default listing", so the hidden-type
  // exclusion lifts (ADR-0065). The palette opens on the Command Palette chord.
  await page.keyboard.press('ControlOrMeta+KeyK');
  await page.getByTestId('command-palette-input').fill('moonlit-keep');
  await expect(page.getByTestId(`command-palette-option-${assetId}`)).toBeVisible();
  await page.keyboard.press('Escape');

  // Pin the Asset to the Dashboard (an Owner-curated field, #168): pinning an Asset is the ordinary Entity
  // pin, no special case.
  const pinned = await page.request.patch(`/api/worlds/${worldId}`, { data: { pinnedEntityIds: [assetId] } });
  expect(pinned.ok(), `${pinned.status()} ${await pinned.text()}`).toBeTruthy();
  expect((await pinned.json()).pinnedEntityIds).toContain(assetId);

  // The Dashboard resolves the pinned tile by id — an id lookup lifts the hidden-type exclusion (#278),
  // so the pinned Asset appears rather than silently dropping out. A full load of the
  // Dashboard root re-reads the World (with its fresh pins) through the active-World guard.
  await page.goto(`/w/${prettyWorld}`);
  await page.waitForURL(/\/w\/[\w-]+$/);
  await expect(page.getByTestId(`pin-${assetId}`)).toBeVisible();
});
