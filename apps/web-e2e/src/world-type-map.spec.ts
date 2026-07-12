import { createEntity, enterLibrary, expect, flushSave, mapViewToggle, savedGrid, test } from './fixtures';

/** The deity's own grid: its `battlemap` Field, not the Hex Map's `grid` — one View per Field. */
const BATTLEMAP_VIEW = mapViewToggle('battlemap');

/**
 * The user-facing payoff of the Structured Field merge (#194/#201): a World Owner gives a type they
 * defined a **map**, code-lessly. Mirrors `dnd-monster.spec.ts` — a whole type's journey, end to end —
 * except that nothing here ships a line of code: the type is authored in the World's settings, and the
 * only thing the map plugin contributed is a data-type on a dropdown.
 *
 * The load-bearing claim is not "a map renders". It is that adding a map to a deity does **not** turn
 * it into a map: the Entity still opens on its Fields, and the grid is one toggle away.
 */
test('a World Owner gives a user-defined type a map, and painting it persists', async ({ page, request }) => {
  const worldId = await enterLibrary(page);

  // 1. Author `world.deity` with a `domain` string and a `battlemap` hex-grid — no code, and no
  //    borrowing the whole `core.hexmap` type to get one grid.
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
  // "Show as a view" comes ticked, and a grid is offered neither as required nor as a facet.
  await expect(gridRow.getByTestId('field-show-as-view')).toBeChecked();

  await page.getByTestId('type-save').click();
  await expect(page.getByTestId('type-world.deity')).toBeVisible();

  // 2. Create an Entity carrying it. The type reaches the "New" menu like any plugin's, because the
  //    registry does not care who authored a type.
  await enterLibrary(page);
  const deityId = await createEntity(page, 'world.deity');
  await expect(page.getByTestId('title')).toBeVisible();

  // 3. It opens on its **Fields**, not its map — the deity presents itself as a deity. That is what
  //    the type's view order buys, and why a Field's View is *placed* rather than implicitly first.
  await expect(page.getByTestId('generic-field-view')).toBeVisible();
  await expect(page.getByTestId('core.view.fields')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId(BATTLEMAP_VIEW)).toHaveAttribute('aria-pressed', 'false');
  // The grid is a document, not a form row: it is edited on its View, never typed into the Fields form.
  await expect(page.getByTestId('field-domain')).toBeVisible();
  await expect(page.getByTestId('field-battlemap')).toHaveCount(0);

  // 4. The map View is there, labelled by the *Field's* name — which is what tells one grid from
  //    another on an Entity that carries two.
  await expect(page.getByTestId(BATTLEMAP_VIEW)).toHaveText('Battlemap');
  await page.getByTestId(BATTLEMAP_VIEW).click();

  // 5. Paint it. The canvas opens on the empty plane the `battlemap` Field minted at create.
  await expect(page.getByTestId('hex-count')).toHaveText('0 hexes');
  await page.getByTestId('tool-terrain').click();
  await page.getByRole('group', { name: 'Terrain' }).getByRole('button', { name: 'Ocean' }).click();
  await page.getByRole('img', { name: 'Hex map' }).click();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');

  await flushSave(page);
  await page.reload();

  // 6. The paint survives the reload, and the active View — Field key and all — survives it with the
  //    paint, since the URL carries the View instance.
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');
  await expect(page.getByTestId(BATTLEMAP_VIEW)).toHaveAttribute('aria-pressed', 'true');

  // And it persisted where a Field's value lives: the Entity's one Metadata map, at the key its
  // author chose — a grid is Metadata, exactly as `dnd.monster`'s `armor_class` is.
  const grid = await savedGrid(request, deityId, 'battlemap');
  expect(Object.values(grid.hexes)).toEqual([{ terrain: 'ocean' }]);
});
