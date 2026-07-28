import {
  addType,
  contentViewToggle,
  createEntity,
  enterEntities,
  entitiesRailLink,
  expect,
  flushSave,
  mapViewToggle,
  statBlockViewToggle,
  test,
} from './fixtures';

/** The Hex Map's map View toggle: bound to the `grid` Field `core.type.hex-map` declares. */
const MAP_VIEW = mapViewToggle();
/** The monster's stat-block View toggle: bound to the `dnd.field.stat-block` Field `dnd.type.monster` places (ADR-0055). */
const STAT_BLOCK_VIEW = statBlockViewToggle();
/** The Note View toggle: `dnd.type.monster` places the content View by id, so it keys plain. */
const NOTE_VIEW = contentViewToggle();

test('creates a dnd.type.monster, fills its stat block, and reads it back', async ({ page, request }) => {
  await enterEntities(page);

  // The monster's stat block is structured (ADR-0055), so it is edited in place on its own View
  // rather than typed into a form row at create time.
  const id = await createEntity(page, 'dnd.type.monster');
  await expect(page.getByTestId('title')).toBeVisible();

  // One View per surface: the plugin's stat block and the rich-content Note, defaulting to the
  // primary type's own (ADR-0048, Views amendment).
  await expect(page.getByTestId(STAT_BLOCK_VIEW)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId(NOTE_VIEW)).toBeVisible();
  // A map View's toggle is keyed by the Field it renders — and a monster has no grid at all.
  await expect(page.getByTestId(MAP_VIEW)).toHaveCount(0);

  await expect(page.getByTestId('stat-block-view')).toBeVisible();

  // The whole block is editable in place — the block is the monster's only stat-authoring surface.
  await page.getByTestId('stat-challenge_rating').locator('input').fill('24');
  await page.getByTestId('stat-strength').locator('input').fill('30');
  // The modifier is derived, not stored: a raw 30 is a +10.
  await expect(page.getByTestId('stat-mod-strength')).toHaveText('+10');

  // A facetable dimension like `size` is settable here, and the subtitle is derived from it.
  await page.getByTestId('stat-size').locator('select').selectOption('Huge');
  await expect(page.getByTestId('stat-block-subtitle')).toContainText('Huge');

  await flushSave(page);
  await page.reload();

  await expect(page.getByTestId('stat-block-view')).toBeVisible();
  await expect(page.getByTestId('stat-challenge_rating').locator('input')).toHaveValue('24');
  await expect(page.getByTestId('stat-strength').locator('input')).toHaveValue('30');
  await expect(page.getByTestId('stat-size').locator('select')).toHaveValue('Huge');

  // The stat block is one grouped value at the `dnd.field.stat-block` key of the one EntityDocument map
  // (ADR-0055/0056), so an instance without the plugin keeps it intact as plain document.
  const res = await request.get(`/api/entities/${id}`);
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.types).toEqual(['dnd.type.monster']);
  expect(body.document['dnd.field.stat-block']).toMatchObject({ challenge_rating: 24, strength: 30, size: 'Huge' });
});

test('a monster’s harvested dimensions surface in the browser rail by presence, no active Type filter (#231/#236)', async ({
  page,
}) => {
  await enterEntities(page);

  const id = await createEntity(page, 'dnd.type.monster');
  await page.getByTestId('title').waitFor();
  await page.getByTestId('stat-challenge_rating').locator('input').fill('24');
  await page.getByTestId('stat-size').locator('select').selectOption('Huge');
  await flushSave(page);

  // Back in the Entity Browser with no Type filter selected: the `size` facet surfaces because the result set
  // carries a value for it — harvested off the stat block's Data Type (ADR-0055), not a scalar Field.
  await entitiesRailLink(page).click();
  await expect(page).toHaveURL(/\/entities$/);
  await expect(page.getByTestId('facet-field-size')).toBeVisible();

  // And it filters the list like any facet: the Huge value narrows to the dragon.
  await page.getByTestId('facet-field-size-Huge').click();
  await expect(page.getByTestId(`open-${id}`)).toBeVisible();
});

test('a dnd.type.monster carrying core.type.hex-map offers the stat block, Note, and Map views', async ({ page }) => {
  await enterEntities(page);

  await createEntity(page, 'dnd.type.monster');

  // Add the hexmap type on the open Entity, which mints the empty grid its `grid` Field declares.
  await addType(page, 'core.type.hex-map');

  await expect(page.getByTestId(STAT_BLOCK_VIEW)).toBeVisible();
  await expect(page.getByTestId(NOTE_VIEW)).toBeVisible();
  await expect(page.getByTestId(MAP_VIEW)).toBeVisible();

  // `dnd.type.monster` is still primary, so its own View stays the default.
  await expect(page.getByTestId(STAT_BLOCK_VIEW)).toHaveAttribute('aria-pressed', 'true');

  // The Map view opens on the empty grid the added type's `grid` Field minted, not a blank frame.
  await page.getByTestId(MAP_VIEW).click();
  await expect(page.getByTestId('tool-terrain')).toBeVisible();
  await expect(page.getByTestId('hex-count')).toHaveText('0 hexes');
});
