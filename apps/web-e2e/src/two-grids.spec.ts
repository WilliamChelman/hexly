import type { Page } from '@playwright/test';
import {
  addType,
  authorWorldType,
  createEntity,
  enterLibrary,
  expect,
  flushSave,
  mapViewToggle,
  savedGrid,
  test,
} from './fixtures';

/** The Hex Map's own grid, at the `grid` key `core.hexmap` declares. */
const MAP_VIEW = mapViewToggle();
/** The deity's grid — a Field a World Owner authored, at the key and under the name they chose. */
const BATTLEMAP_VIEW = mapViewToggle('world.battlemap');

/**
 * An Entity carrying `core.hexmap` *and* a user-defined type with its own grid Field affords two map
 * Views. What is asserted here is not that undo works (the unit specs cover that) but that each View
 * has its own store and its own undo stack, over its own Field's slice.
 */
test('an Entity with two grids affords two map Views, each with its own paint and undo', async ({ page, request }) => {
  const worldId = await enterLibrary(page);
  await authorWorldType(page, worldId, {
    id: 'deity',
    name: 'Deity',
    fields: [{ segment: 'battlemap', label: 'Battlemap', kind: 'core.hex-grid' }],
  });

  await enterLibrary(page);
  const entityId = await createEntity(page, 'core.hexmap');
  await expect(page.getByTestId('hex-count')).toHaveText('0 hexes');

  // Paint the world map *before* the deity's grid exists, so its hexes cannot be a fresh mint.
  await paint(page, 'Ocean', [0, 1]);
  await expect(page.getByTestId('hex-count')).toHaveText('2 hexes');

  await addType(page, 'world.deity');

  // Two map toggles, each named by its Field — which is what tells the world map from the battlemap.
  await expect(page.getByTestId(MAP_VIEW)).toHaveText('Map');
  await expect(page.getByTestId(BATTLEMAP_VIEW)).toHaveText('Battlemap');
  // `core.hexmap` is still primary, so the live map is the one we were painting, untorn.
  await expect(page.getByTestId(MAP_VIEW)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('hex-count')).toHaveText('2 hexes');

  await page.getByTestId('undo').click();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');

  // The deity's grid is its own empty plane: the world map's two strokes never reached it.
  await page.getByTestId(BATTLEMAP_VIEW).click();
  await expect(page.getByTestId('hex-count')).toHaveText('0 hexes');

  await paint(page, 'Mountains', [0, 1, 2]);
  await expect(page.getByTestId('hex-count')).toHaveText('3 hexes');
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('hex-count')).toHaveText('2 hexes');

  await page.getByTestId(MAP_VIEW).click();
  // Neither the battlemap's paint nor its undo moved the world map off the hex it was left on.
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');
  // And its undo cannot reach them: a View's history is its own, minted with the store that owns its
  // Field. One shared stack would offer the battlemap's three strokes to rewind here.
  await expect(page.getByTestId('undo')).toBeDisabled();

  // Painting with both grids live still lands in one: the strokes above could not have leaked, since
  // the second grid did not exist yet — these could.
  await paint(page, 'Ocean', [2, 3]);
  await expect(page.getByTestId('hex-count')).toHaveText('3 hexes');
  await page.getByTestId(BATTLEMAP_VIEW).click();
  await expect(page.getByTestId('hex-count')).toHaveText('2 hexes');

  await flushSave(page);
  await page.reload();

  // The battlemap was showing, and it is showing still: the URL carries the Field key with the View
  // id, so it is *this* grid the reload restores, not the Hex Map's.
  await expect(page.getByTestId(BATTLEMAP_VIEW)).toHaveAttribute('aria-pressed', 'true');
  // Each View comes back on its own grid — the counts differ, so a View resolving to the wrong Field
  // could not read as the right one.
  await expect(page.getByTestId('hex-count')).toHaveText('2 hexes');
  await page.getByTestId(MAP_VIEW).click();
  await expect(page.getByTestId('hex-count')).toHaveText('3 hexes');

  // Two Fields of the one EntityDocument map, each holding the terrain painted on its own View (ADR-0050).
  const worldMap = await savedGrid(request, entityId);
  const battlemap = await savedGrid(request, entityId, 'world.battlemap');
  expect(Object.values(worldMap.hexes)).toEqual([{ terrain: 'ocean' }, { terrain: 'ocean' }, { terrain: 'ocean' }]);
  expect(Object.values(battlemap.hexes)).toEqual([{ terrain: 'mountain' }, { terrain: 'mountain' }]);
});

/**
 * Arm `terrain` and paint one hex per slot. A slot is a step along the canvas's middle row, 70px
 * apart — wider than one hex, so each is its own coordinate and a slot names the same hex every time.
 */
async function paint(page: Page, terrain: string, slots: readonly number[]): Promise<void> {
  await page.getByTestId('tool-terrain').click();
  await page.getByRole('group', { name: 'Terrain' }).getByRole('button', { name: terrain }).click();

  const canvas = page.getByRole('img', { name: 'Hex map' });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not laid out');
  for (const slot of slots) {
    await canvas.click({ position: { x: box.width / 2 + slot * 70, y: box.height / 2 } });
  }
}
