import { enterLibrary, entityIdFromUrl, expect, flushSave, openEntityActions, test } from './fixtures';

/**
 * The bundled `dnd.monster` plugin (#192): a compiled-in plugin teaches Hexly a whole kind of thing
 * through the same registration the core dogfoods — a Field schema the API validates and facets, and
 * a bespoke stat-block View the web renders. This walks the path a worldbuilder actually takes:
 * create a monster, fill its required Field, and read the stat block.
 */
test('creates a dnd.monster, fills its required Fields, and reads the stat block', async ({ page, request }) => {
  await enterLibrary(page);

  // The plugin's create Command is not hand-wired anywhere: it falls out of the type registry, so
  // registering `dnd.monster` is the whole of what put it in the palette.
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByTestId('command-palette-input').fill('>monster');
  await page.getByTestId('command-palette-option-create-dnd.monster').click();

  await expect(page.getByTestId('create-entity-name')).toBeVisible();
  await page.getByTestId('create-entity-name').fill('Ancient Red Dragon');

  // Create is gated until the plugin type's required Field is supplied (forward-only, #187/#189):
  // the schema the dialog reads here is the same one the API's write gate resolves.
  const submit = page.getByTestId('create-entity-submit');
  await expect(submit).toHaveAttribute('aria-disabled', 'true');

  await page.getByTestId('create-field-challenge_rating').locator('input').fill('24');
  await expect(submit).not.toHaveAttribute('aria-disabled', 'true');
  await submit.click();

  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const id = entityIdFromUrl(page);
  await expect(page.getByTestId('title')).toHaveText('Ancient Red Dragon');

  // One View per surface the Entity affords: the plugin's stat block and the rich-content Note,
  // defaulting to the primary type's own (ADR-0048, Views amendment).
  await expect(page.getByTestId('dnd.view.stat-block')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('core.view.content')).toBeVisible();
  await expect(page.getByTestId('core.view.map')).toHaveCount(0);

  // The stat block, not raw prose: the CR carried over from the create dialog, and the rest of the
  // block editable in place.
  const statBlock = page.getByTestId('stat-block-view');
  await expect(statBlock).toBeVisible();
  await expect(page.getByTestId('stat-challenge_rating').locator('input')).toHaveValue('24');

  await page.getByTestId('stat-strength').locator('input').fill('30');
  // The derived modifier is what a bespoke view buys — a raw 30 is a +10 to roll with.
  await expect(page.getByTestId('stat-mod-strength')).toHaveText('+10');

  // The block is the only surface the *optional* Fields have (the create dialog collects the required
  // ones), so a facetable Field like `size` must be settable right here.
  await page.getByTestId('stat-size').locator('select').selectOption('Huge');
  await expect(page.getByTestId('stat-block-subtitle')).toContainText('Huge');

  await flushSave(page);
  await page.reload();

  await expect(page.getByTestId('stat-block-view')).toBeVisible();
  await expect(page.getByTestId('stat-strength').locator('input')).toHaveValue('30');
  await expect(page.getByTestId('stat-size').locator('select')).toHaveValue('Huge');

  // A Field is a lens over the one Metadata map, not a store of its own — so the stat block's values
  // are exactly the Entity's Metadata, which is why an instance without the plugin loses nothing.
  const res = await request.get(`/api/entities/${id}`);
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.types).toEqual(['dnd.monster']);
  expect(body.document.metadata).toMatchObject({ challenge_rating: 24, strength: 30, size: 'Huge' });
});

/**
 * View-per-surface (#192): payloads compose, so a monster that is *also* a hex map offers one View
 * per surface it affords — the stat block, the Note, and the Map — with no special case anywhere.
 */
test('a dnd.monster carrying core.hexmap offers the stat block, Note, and Map views', async ({ page }) => {
  await enterLibrary(page);

  await page.keyboard.press('ControlOrMeta+k');
  await page.getByTestId('command-palette-input').fill('>monster');
  await page.getByTestId('command-palette-option-create-dnd.monster').click();
  await page.getByTestId('create-entity-name').fill('The Sunken Keep');
  await page.getByTestId('create-field-challenge_rating').locator('input').fill('7');
  await page.getByTestId('create-entity-submit').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);

  // Add the hexmap type on the open Entity, which mints the hex-grid payload over the rich-content base.
  await openEntityActions(page);
  await page.getByTestId('edit-types').click();
  await page.getByTestId('type-add').selectOption('core.hexmap');
  await page.getByTestId('types-close').click();

  await expect(page.getByTestId('dnd.view.stat-block')).toBeVisible();
  await expect(page.getByTestId('core.view.content')).toBeVisible();
  await expect(page.getByTestId('core.view.map')).toBeVisible();

  // `dnd.monster` is still primary, so its own View stays the default.
  await expect(page.getByTestId('dnd.view.stat-block')).toHaveAttribute('aria-pressed', 'true');

  // The Map view opens on the empty grid the added type minted (`withPayloadsFor`), not a blank frame.
  await page.getByTestId('core.view.map').click();
  await expect(page.getByTestId('tool-terrain')).toBeVisible();
  await expect(page.getByTestId('hex-count')).toHaveText('0 hexes');
});
