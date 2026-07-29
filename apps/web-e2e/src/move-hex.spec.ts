import { createEntity, enterEntities, expect, flushSave, test, savedGrid } from './fixtures';

/**
 * The whole-Hex move journey (ADR-0010): a press over a selected hex arms a move, crossing a small
 * pixel threshold turns it into a `moveSelection`, committed once on release.
 *
 * The canvas centres the world origin on load, so a press at the canvas centre grabs hex (0,0);
 * dragging ~100px lands the content on a different coordinate.
 */
test('drags a hex under Select to a new coordinate, and the move survives a reload', async ({ page, request }) => {
  await enterEntities(page);
  const mapId = await createEntity(page, 'core.type.hex-map');

  const canvas = page.getByRole('img', { name: 'Hex map' });

  // Arm Select so the next press selects rather than paints.
  await page.getByTestId('tool-terrain').click();
  await canvas.click();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');
  await page.getByTestId('tool-select').click();

  // Explicit intermediate moves: the canvas drives the gesture off `pointermove`, so the pointer
  // must step across the threshold for the drag to register. 100px is well past the ~69px column
  // spacing, so it lands on a different hex.
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not laid out');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = 100;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy);
  await page.mouse.move(cx + 80, cy);
  await page.mouse.move(cx + dx, cy);
  await page.mouse.up();

  // The hex moved rather than duplicated: still exactly one hex on the map.
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');

  // Pinning the exact coordinate catches a move to the wrong hex.
  await expect(page.getByTestId('entity-detail')).toHaveText('Forest');
  await expect(page.getByTestId('entity-coord')).toContainText('q 1 · r 0');

  await flushSave(page);

  const grid = await savedGrid(request, mapId);
  const hexes = grid.hexes as Record<string, { terrain: string }>;
  expect(Object.keys(hexes)).toHaveLength(1);
  expect(hexes['0,0']).toBeUndefined();
  expect(hexes['1,0']).toEqual({ terrain: 'forest' });

  await page.reload();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');

  // Re-read the canvas box after reload: origin-centering may differ.
  const box2 = await canvas.boundingBox();
  if (!box2) throw new Error('canvas not laid out after reload');

  await canvas.click({ position: { x: box2.width / 2, y: box2.height / 2 } });
  await expect(page.getByTestId('entity-coord')).toHaveCount(0);

  await canvas.click({
    position: { x: box2.width / 2 + dx, y: box2.height / 2 },
  });
  await expect(page.getByTestId('entity-detail')).toHaveText('Forest');
});

/**
 * The non-destructive swap (ADR-0017): dropping a Hex onto an occupied hex exchanges the two whole
 * records rather than overwriting, so a move never silently destroys content.
 */
test('drags a hex onto an occupied hex and swaps the two, surviving a reload', async ({ page, request }) => {
  await enterEntities(page);
  const mapId = await createEntity(page, 'core.type.hex-map');

  const canvas = page.getByRole('img', { name: 'Hex map' });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not laid out');
  const dx = 100; // a +100px drag at zoom 1 lands on the q1·r0 neighbour

  await page.getByTestId('tool-terrain').click();
  await canvas.click();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');

  // Paint the neighbour hex (Ocean) so the drop target is occupied.
  await page.getByRole('group', { name: 'Terrain' }).getByRole('button', { name: 'Ocean' }).click();
  await canvas.click({
    position: { x: box.width / 2 + dx, y: box.height / 2 },
  });
  await expect(page.getByTestId('hex-count')).toHaveText('2 hexes');

  await page.getByTestId('tool-select').click();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy);
  await page.mouse.move(cx + 80, cy);
  await page.mouse.move(cx + dx, cy);
  await page.mouse.up();

  await expect(page.getByTestId('hex-count')).toHaveText('2 hexes');
  await expect(page.getByTestId('entity-detail')).toHaveText('Forest');
  await expect(page.getByTestId('entity-coord')).toContainText('q 1 · r 0');

  // The occupant slid back to the origin.
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(page.getByTestId('entity-detail')).toHaveText('Ocean');
  await expect(page.getByTestId('entity-coord')).toContainText('q 0 · r 0');

  await flushSave(page);

  const grid = await savedGrid(request, mapId);
  const hexes = grid.hexes as Record<string, { terrain: string }>;
  expect(hexes['0,0']).toEqual({ terrain: 'ocean' });
  expect(hexes['1,0']).toEqual({ terrain: 'forest' });

  await page.reload();
  await expect(page.getByTestId('hex-count')).toHaveText('2 hexes');
  const box2 = await canvas.boundingBox();
  if (!box2) throw new Error('canvas not laid out after reload');
  await canvas.click({ position: { x: box2.width / 2, y: box2.height / 2 } });
  await expect(page.getByTestId('entity-detail')).toHaveText('Ocean');
  await canvas.click({
    position: { x: box2.width / 2 + dx, y: box2.height / 2 },
  });
  await expect(page.getByTestId('entity-detail')).toHaveText('Forest');
});

/**
 * Escape aborts an in-progress Hex drag: the move is never committed, so the hex stays at its
 * origin and the destination stays Void.
 */
test('Escape cancels an in-progress Hex drag, leaving the hex at its origin', async ({ page }) => {
  await enterEntities(page);
  await createEntity(page, 'core.type.hex-map');

  const canvas = page.getByRole('img', { name: 'Hex map' });

  await page.getByTestId('tool-terrain').click();
  await canvas.click();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');
  await page.getByTestId('tool-select').click();

  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not laid out');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = 100;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy);
  await page.mouse.move(cx + dx, cy);
  await page.keyboard.press('Escape');
  // Pressing Escape mid-drag should not resume when dragging resumes.
  await page.mouse.move(cx + dx + 40, cy);
  await page.mouse.up();

  // The move never committed: hex stays at origin.
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');
  await expect(page.getByTestId('entity-coord')).toContainText('q 0');
  await expect(page.getByTestId('entity-detail')).toHaveText('Forest');

  // The hex never moved: drag destination is still Void.
  await canvas.click({
    position: { x: box.width / 2 + dx, y: box.height / 2 },
  });
  await expect(page.getByTestId('entity-coord')).toHaveCount(0);
});

/**
 * The whole-group move (ADR-0017): dragging a multi-hex Selection translates *every* member by one
 * offset in a single step, keeping the cluster's shape. A press on an already-selected member drags
 * the whole set.
 */
test('drags a multi-hex selection so the whole group moves by one offset', async ({ page, request }) => {
  await enterEntities(page);
  const mapId = await createEntity(page, 'core.type.hex-map');

  const canvas = page.getByRole('img', { name: 'Hex map' });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not laid out');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = 100; // a +100px drag at zoom 1 spans one column (offset q+1)

  await page.getByTestId('tool-terrain').click();
  await canvas.click();
  // Paint Ocean at the q1·r0 neighbour.
  await page.getByRole('group', { name: 'Terrain' }).getByRole('button', { name: 'Ocean' }).click();
  await canvas.click({
    position: { x: box.width / 2 + dx, y: box.height / 2 },
  });
  await expect(page.getByTestId('hex-count')).toHaveText('2 hexes');

  // Build a two-hex Selection: click the centre, then Shift-click the neighbour.
  await page.getByTestId('tool-select').click();
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await canvas.click({
    position: { x: box.width / 2 + dx, y: box.height / 2 },
    modifiers: ['Shift'],
  });

  // Drag the whole set one column to the right.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy);
  await page.mouse.move(cx + 80, cy);
  await page.mouse.move(cx + dx, cy);
  await page.mouse.up();

  await expect(page.getByTestId('hex-count')).toHaveText('2 hexes');

  // Each member rode by the same offset, so the cluster kept its shape.
  await flushSave(page);

  const grid = await savedGrid(request, mapId);
  const hexes = grid.hexes as Record<string, { terrain: string }>;
  expect(hexes['0,0']).toBeUndefined();
  expect(hexes['1,0']).toEqual({ terrain: 'forest' });
  expect(hexes['2,0']).toEqual({ terrain: 'ocean' });
});

/**
 * A blocked group move is a no-op that snaps back (ADR-0017): when a member's destination is
 * occupied by a non-selected hex that can only be displaced onto the moving group's own path, the
 * whole move is refused and the document is left untouched — nothing moves.
 */
test('refuses a blocked group move, leaving every hex where it was', async ({ page, request }) => {
  await enterEntities(page);
  const mapId = await createEntity(page, 'core.type.hex-map');

  const canvas = page.getByRole('img', { name: 'Hex map' });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not laid out');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = 100; // one column right
  const dx2 = 138; // two columns right (q2·r0)

  // Paint a contiguous row of three: Forest (0,0), Ocean (1,0), Grassland (2,0).
  await page.getByTestId('tool-terrain').click();
  await canvas.click();
  const terrain = page.getByRole('group', { name: 'Terrain' });
  await terrain.getByRole('button', { name: 'Ocean' }).click();
  await canvas.click({
    position: { x: box.width / 2 + dx, y: box.height / 2 },
  });
  await terrain.getByRole('button', { name: 'Grassland' }).click();
  await canvas.click({
    position: { x: box.width / 2 + dx2, y: box.height / 2 },
  });
  await expect(page.getByTestId('hex-count')).toHaveText('3 hexes');

  // Select only the first two (Forest + Ocean); leave Grassland out.
  await page.getByTestId('tool-select').click();
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await canvas.click({
    position: { x: box.width / 2 + dx, y: box.height / 2 },
    modifiers: ['Shift'],
  });

  // Attempt drag: Ocean would land on Grassland, which could only
  // be pushed onto where Forest is landing — a self-overlapping nudge that blocks.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy);
  await page.mouse.move(cx + 80, cy);
  await page.mouse.move(cx + dx, cy);
  await page.mouse.up();

  await expect(page.getByTestId('hex-count')).toHaveText('3 hexes');

  // The refusal is surfaced as a toast.
  await expect(page.locator('.toast', { hasText: 'Move blocked' })).toBeVisible();

  await flushSave(page);

  const grid = await savedGrid(request, mapId);
  const hexes = grid.hexes as Record<string, { terrain: string }>;
  // Every hex is exactly where it was painted.
  expect(hexes['0,0']).toEqual({ terrain: 'forest' });
  expect(hexes['1,0']).toEqual({ terrain: 'ocean' });
  expect(hexes['2,0']).toEqual({ terrain: 'grass' });
});
