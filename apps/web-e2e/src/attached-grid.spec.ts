import type { Page } from '@playwright/test';
import {
  attachField,
  authorWorldField,
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
/** The attached grid — a World Field a worldbuilder authored and hung on this one Entity (ADR-0054). */
const BATTLEMAP_VIEW = mapViewToggle('battlemap');

/**
 * A Field of a Structured Data Type attached *directly* to an Entity auto-affords its View (#232,
 * ADR-0054): a `core.hexmap` carrying an instance-attached `battlemap` Field of the `core.hex-grid` Data Type affords
 * a second map View, appended after its type-placed Views in `fields[]` order. The sibling of
 * `two-grids.spec.ts`, which reaches the second grid through a *type* — here the grid rides no type at
 * all, only the attachment. What is asserted is the same: each View has its own store and undo stack,
 * over its own Field's slice of the one EntityDocument.
 */
test('an attached grid Field affords its own map View, with its own paint and undo', async ({ page, request }) => {
  const worldId = await enterLibrary(page);
  // A reusable World Field of the grid Data Type — no type declares it; it exists to be attached.
  await authorWorldField(page, worldId, {
    id: 'battlemap',
    key: 'battlemap',
    label: 'Battlemap',
    kind: 'core.hex-grid',
  });

  await enterLibrary(page);
  const entityId = await createEntity(page, 'core.hexmap');
  await expect(page.getByTestId('hex-count')).toHaveText('0 hexes');

  // Paint the world map *before* the battlemap is attached, so its hexes cannot be a fresh mint.
  await paint(page, 'Ocean', [0, 1]);
  await expect(page.getByTestId('hex-count')).toHaveText('2 hexes');

  await attachField(page, 'world.battlemap');

  // Two map toggles: the type-placed grid View first, then the attachment's — appended in `fields[]`
  // order (CONTEXT.md → View), each named by its Field, which is what tells the world map from the battlemap.
  await expect(page.getByTestId(MAP_VIEW)).toHaveText('Map');
  await expect(page.getByTestId(BATTLEMAP_VIEW)).toHaveText('Battlemap');
  // `core.hexmap`'s grid is still the default View, so the live map is the one we were painting, untorn.
  await expect(page.getByTestId(MAP_VIEW)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('hex-count')).toHaveText('2 hexes');

  await page.getByTestId('undo').click();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');

  // The attached grid is its own empty plane: the world map's two strokes never reached it, and
  // attaching it minted its own default rather than borrowing the grid's slice.
  await page.getByTestId(BATTLEMAP_VIEW).click();
  await expect(page.getByTestId('hex-count')).toHaveText('0 hexes');

  await paint(page, 'Mountains', [0, 1, 2]);
  await expect(page.getByTestId('hex-count')).toHaveText('3 hexes');
  await page.getByTestId('undo').click();
  await expect(page.getByTestId('hex-count')).toHaveText('2 hexes');

  await page.getByTestId(MAP_VIEW).click();
  // Neither the battlemap's paint nor its undo moved the world map off the hex it was left on.
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');
  // And its undo cannot reach them: an attached View's history is its own, minted with the store that
  // owns its Field. One shared stack would offer the battlemap's three strokes to rewind here.
  await expect(page.getByTestId('undo')).toBeDisabled();

  // Painting with both grids live still lands in one: the strokes above could not have leaked, since
  // the attachment did not exist yet — these could.
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

  // Two Fields of the one EntityDocument map, each holding the terrain painted on its own View
  // (ADR-0050) — and the attachment persists in `fields[]`.
  const worldMap = await savedGrid(request, entityId);
  const battlemap = await savedGrid(request, entityId, 'battlemap');
  expect(Object.values(worldMap.hexes)).toEqual([{ terrain: 'ocean' }, { terrain: 'ocean' }, { terrain: 'ocean' }]);
  expect(Object.values(battlemap.hexes)).toEqual([{ terrain: 'mountain' }, { terrain: 'mountain' }]);

  const res = await request.get(`/api/entities/${entityId}`);
  expect((await res.json()).fields).toEqual(['world.battlemap']);
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
