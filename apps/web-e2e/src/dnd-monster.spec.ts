import { addType, enterLibrary, entityIdFromUrl, expect, flushSave, mapViewToggle, test } from './fixtures';

/** The Hex Map's map View toggle: bound to the `grid` Field `core.hexmap` declares. */
const MAP_VIEW = mapViewToggle();

test('creates a dnd.monster, fills its required Fields, and reads the stat block', async ({ page, request }) => {
  await enterLibrary(page);

  // The create Command is hand-wired nowhere: it falls out of the type registry.
  await page.keyboard.press('ControlOrMeta+k');
  await page.getByTestId('command-palette-input').fill('>monster');
  await page.getByTestId('command-palette-option-create-dnd.monster').click();

  await expect(page.getByTestId('create-entity-name')).toBeVisible();
  await page.getByTestId('create-entity-name').fill('Ancient Red Dragon');

  // Create is gated until the type's required Field is supplied (forward-only, #187/#189); the dialog
  // reads the same schema the API's write gate resolves.
  const submit = page.getByTestId('create-entity-submit');
  await expect(submit).toHaveAttribute('aria-disabled', 'true');

  await page.getByTestId('create-field-challenge_rating').locator('input').fill('24');
  await expect(submit).not.toHaveAttribute('aria-disabled', 'true');
  await submit.click();

  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const id = entityIdFromUrl(page);
  await expect(page.getByTestId('title')).toHaveText('Ancient Red Dragon');

  // One View per surface: the plugin's stat block and the rich-content Note, defaulting to the
  // primary type's own (ADR-0048, Views amendment).
  await expect(page.getByTestId('dnd.view.stat-block')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('core.view.content')).toBeVisible();
  // A map View's toggle is keyed by the Field it renders — and a monster has no grid at all.
  await expect(page.getByTestId(MAP_VIEW)).toHaveCount(0);

  // The CR carries over from the create dialog; the rest of the block is editable in place.
  await expect(page.getByTestId('stat-block-view')).toBeVisible();
  await expect(page.getByTestId('stat-challenge_rating').locator('input')).toHaveValue('24');

  await page.getByTestId('stat-strength').locator('input').fill('30');
  // The modifier is derived, not stored: a raw 30 is a +10.
  await expect(page.getByTestId('stat-mod-strength')).toHaveText('+10');

  // The block is the only surface the optional Fields have (the create dialog collects the required
  // ones), so a facetable Field like `size` must be settable here.
  await page.getByTestId('stat-size').locator('select').selectOption('Huge');
  await expect(page.getByTestId('stat-block-subtitle')).toContainText('Huge');

  await flushSave(page);
  await page.reload();

  await expect(page.getByTestId('stat-block-view')).toBeVisible();
  await expect(page.getByTestId('stat-strength').locator('input')).toHaveValue('30');
  await expect(page.getByTestId('stat-size').locator('select')).toHaveValue('Huge');

  // A Field is a lens over the one EntityDocument map — which is the body itself now (ADR-0051): the stat
  // block's values sit at the body root, so an instance without the plugin loses nothing.
  const res = await request.get(`/api/entities/${id}`);
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.types).toEqual(['dnd.monster']);
  expect(body.document).toMatchObject({ challenge_rating: 24, strength: 30, size: 'Huge' });
});

test('a dnd.monster carrying core.hexmap offers the stat block, Note, and Map views', async ({ page }) => {
  await enterLibrary(page);

  await page.keyboard.press('ControlOrMeta+k');
  await page.getByTestId('command-palette-input').fill('>monster');
  await page.getByTestId('command-palette-option-create-dnd.monster').click();
  await page.getByTestId('create-entity-name').fill('The Sunken Keep');
  await page.getByTestId('create-field-challenge_rating').locator('input').fill('7');
  await page.getByTestId('create-entity-submit').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);

  // Add the hexmap type on the open Entity, which mints the empty grid its `grid` Field declares.
  await addType(page, 'core.hexmap');

  await expect(page.getByTestId('dnd.view.stat-block')).toBeVisible();
  await expect(page.getByTestId('core.view.content')).toBeVisible();
  await expect(page.getByTestId(MAP_VIEW)).toBeVisible();

  // `dnd.monster` is still primary, so its own View stays the default.
  await expect(page.getByTestId('dnd.view.stat-block')).toHaveAttribute('aria-pressed', 'true');

  // The Map view opens on the empty grid the added type's `grid` Field minted, not a blank frame.
  await page.getByTestId(MAP_VIEW).click();
  await expect(page.getByTestId('tool-terrain')).toBeVisible();
  await expect(page.getByTestId('hex-count')).toHaveText('0 hexes');
});
