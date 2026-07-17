import {
  authorWorldType,
  createEntity,
  enterLibrary,
  expect,
  flushSave,
  mapViewToggle,
  savedGrid,
  test,
} from './fixtures';

/** The deity's own grid: its `battlemap` Field, not the Hex Map's `grid` — one View per Field. */
const BATTLEMAP_VIEW = mapViewToggle('world.battlemap');

/**
 * A World Owner gives a type they authored in the World's settings a map, code-lessly: the map
 * plugin contributes only a data-type on a dropdown. Adding a grid to a deity does not turn it into
 * a map — the Entity still opens on its Fields, with the grid one toggle away.
 */
test('a World Owner gives a user-defined type a map, and painting it persists', async ({ page, request }) => {
  const worldId = await enterLibrary(page);

  // Author `world.deity` with a `domain` string and a `battlemap` hex-grid — the map plugin's
  // data-type, offered beside `string` and `enum`, and the whole ceremony.
  await authorWorldType(page, worldId, {
    id: 'deity',
    name: 'Deity',
    fields: [
      { segment: 'domain', label: 'Domain' },
      { segment: 'battlemap', label: 'Battlemap', kind: 'core.hex-grid' },
    ],
  });

  // "Show as a view" defaulted to on, and stayed on through the save — which is what affords the
  // View toggled below.
  await page.getByTestId('edit-world.deity').click();
  await expect(page.getByTestId('field-show-as-view-world.battlemap')).toBeChecked();
  await page.getByTestId('type-cancel').click();

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
  await expect(page.getByTestId('field-world.domain')).toBeVisible();
  await expect(page.getByTestId('field-world.battlemap')).toHaveCount(0);

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

  // And it persisted where a Field's value lives: the Entity's EntityDocument, at the key its author chose.
  const grid = await savedGrid(request, deityId, 'world.battlemap');
  expect(Object.values(grid.hexes)).toEqual([{ terrain: 'ocean' }]);
});
