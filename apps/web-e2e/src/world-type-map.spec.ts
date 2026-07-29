import {
  authorWorldType,
  createEntity,
  enterEntities,
  expect,
  flushSave,
  mapViewToggle,
  openDetails,
  savedGrid,
  test,
} from './fixtures';

/** The deity's own grid: its `battlemap` Field, not the Hex Map's `grid` — one View per Field. */
const BATTLEMAP_VIEW = mapViewToggle('world.field.battle-map');

/**
 * A World Owner gives a type they authored in the World's settings a map, code-lessly: the map
 * plugin contributes only a data-type on a dropdown. The battlemap is the deity's only View, so it
 * opens straight on the map (ADR-0067 — the Details View is fallback-only and leaves the toggle when
 * another View exists); its scalar Fields live in the Details Panel.
 */
test('a World Owner gives a user-defined type a map, and painting it persists', async ({ page, request }) => {
  const worldId = await enterEntities(page);

  // Author `world.type.deity` with a `domain` string and a `battlemap` hex-grid — the map plugin's
  // data-type, offered beside `string` and `enum`, and the whole ceremony.
  await authorWorldType(page, worldId, {
    id: 'deity',
    name: 'Deity',
    fields: [
      { segment: 'domain', label: 'Domain' },
      { segment: 'battle-map', label: 'Battlemap', kind: 'core.datatype.hex-grid' },
    ],
  });

  // "Show as a view" defaulted to on, and stayed on through the save — which is what affords the
  // View toggled below.
  await page.getByTestId('edit-world.type.deity').click();
  await expect(page.getByTestId('field-show-as-view-world.field.battle-map')).toBeChecked();
  await page.getByTestId('type-cancel').click();

  // The type reaches the "New" menu like a plugin's: the registry does not care who authored one.
  await enterEntities(page);
  const deityId = await createEntity(page, 'world.type.deity');
  await expect(page.getByTestId('title')).toBeVisible();

  // The battlemap is the only View the deity affords, so the canvas opens straight away — no toggle,
  // since a single View shows none (ADR-0067). It opens on the empty plane the Field minted at create.
  await expect(page.getByTestId('hex-count')).toHaveText('0 hexes');
  await expect(page.getByTestId(BATTLEMAP_VIEW)).toHaveCount(0);

  await page.getByTestId('tool-terrain').click();
  await page.getByRole('group', { name: 'Terrain' }).getByRole('button', { name: 'Ocean' }).click();
  await page.getByRole('img', { name: 'Hex map' }).click();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');

  await flushSave(page);
  await page.reload();

  // The paint survives, and the map is still what the Entity opens on.
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');

  // The scalar `domain` Field lives in the Details Panel now; a grid is a document, not a form row, so
  // it never shows there as a control (ADR-0067).
  await openDetails(page);
  await expect(page.getByTestId('detail-field-world.field.domain')).toBeVisible();
  await expect(page.getByTestId('detail-field-world.field.battle-map')).toHaveCount(0);

  // And it persisted where a Field's value lives: the Entity's EntityDocument, at the key its author chose.
  const grid = await savedGrid(request, deityId, 'world.field.battle-map');
  expect(Object.values(grid.hexes)).toEqual([{ terrain: 'ocean' }]);
});
