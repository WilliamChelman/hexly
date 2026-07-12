import { createEntity, enterLibrary, expect, flushSave, mapViewToggle, savedGrid, test } from './fixtures';

/** The deity's own grid: its `battlemap` Field, not the Hex Map's `grid` — one View per Field. */
const BATTLEMAP_VIEW = mapViewToggle('battlemap');

/**
 * A World Owner gives a type they defined a map, code-lessly (#194/#201) — the mirror of
 * `dnd-monster.spec.ts`, for a type that ships no code at all: it is authored in the World's settings,
 * and the map plugin contributed only a data-type on a dropdown.
 *
 * The load-bearing claim is not that a map renders, but that adding one to a deity does not turn it
 * into a map: the Entity still opens on its Fields, with the grid one toggle away.
 */
test('a World Owner gives a user-defined type a map, and painting it persists', async ({ page, request }) => {
  const worldId = await enterLibrary(page);

  // Author `world.deity` with a `domain` string and a `battlemap` hex-grid.
  await page.goto(`/w/${worldId}/settings`);
  await page.getByTestId('type-new').click();
  await page.getByTestId('type-id-input').fill('deity');
  await page.getByTestId('type-name-input').fill('Deity');

  await page.getByTestId('add-field').click();
  await page.getByTestId('field-0').getByTestId('field-key').fill('domain');
  await page.getByTestId('field-0').getByTestId('field-label').fill('Domain');

  await page.getByTestId('add-field').click();
  const gridRow = page.getByTestId('field-1');
  await gridRow.getByTestId('field-key').fill('battlemap');
  await gridRow.getByTestId('field-label').fill('Battlemap');
  // The map plugin's data-type, offered beside `string` and `enum` — the whole ceremony.
  await gridRow.getByTestId('field-kind').selectOption('core.hex-grid');
  await expect(gridRow.getByTestId('field-show-as-view')).toBeChecked();

  await page.getByTestId('type-save').click();
  await expect(page.getByTestId('type-world.deity')).toBeVisible();

  // The type reaches the "New" menu like a plugin's: the registry does not care who authored one.
  await enterLibrary(page);
  const deityId = await createEntity(page, 'world.deity');
  await expect(page.getByTestId('title')).toBeVisible();

  // It opens on its Fields, not its map — what the type's view order buys, and why a Field's View is
  // placed rather than implicitly first.
  await expect(page.getByTestId('generic-field-view')).toBeVisible();
  await expect(page.getByTestId('core.view.fields')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId(BATTLEMAP_VIEW)).toHaveAttribute('aria-pressed', 'false');
  // A grid is a document, not a form row: it is edited on its View, never in the Fields form.
  await expect(page.getByTestId('field-domain')).toBeVisible();
  await expect(page.getByTestId('field-battlemap')).toHaveCount(0);

  // Its toggle is labelled by the Field, which is what tells one grid from another.
  await expect(page.getByTestId(BATTLEMAP_VIEW)).toHaveText('Battlemap');
  await page.getByTestId(BATTLEMAP_VIEW).click();

  // The canvas opens on the empty plane the `battlemap` Field minted at create.
  await expect(page.getByTestId('hex-count')).toHaveText('0 hexes');
  await page.getByTestId('tool-terrain').click();
  await page.getByRole('group', { name: 'Terrain' }).getByRole('button', { name: 'Ocean' }).click();
  await page.getByRole('img', { name: 'Hex map' }).click();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');

  await flushSave(page);
  await page.reload();

  // The paint survives, and so does the active View — the URL carries the Field key with the View id.
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');
  await expect(page.getByTestId(BATTLEMAP_VIEW)).toHaveAttribute('aria-pressed', 'true');

  // And it persisted where a Field's value lives: the Entity's Metadata, at the key its author chose.
  const grid = await savedGrid(request, deityId, 'battlemap');
  expect(Object.values(grid.hexes)).toEqual([{ terrain: 'ocean' }]);
});
