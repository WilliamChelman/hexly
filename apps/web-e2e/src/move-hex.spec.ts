import { expect, test } from './fixtures';

/**
 * The whole-Hex move journey (issue #30, ADR-0010). It crosses the one seam the
 * store unit tests cannot reach: the canvas press→drag-threshold gesture, where a
 * press over a selected hex arms a move and crossing a small pixel threshold turns
 * it into a `moveSelection`, committed once on release. Like the other canvas journeys
 * it then proves persistence with a direct API read of the saved document and a
 * reload (ADR-0003/0009): map state lives as Canvas pixels, so we observe the move
 * through the hex count, the inspector, and the persisted hexes record.
 *
 * The canvas centres the world origin on load, so a press at the canvas centre
 * grabs hex (0,0); dragging ~100px lands the content on a different coordinate.
 */
test('drags a hex under Select to a new coordinate, and the move survives a reload', async ({
  page,
  request,
}) => {
  await page.goto('/entities');
  await page.getByTestId('new-map').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const mapId = page.url().split('/').pop();

  const canvas = page.getByRole('img', { name: 'Hex map' });

  // Paint the centre hex with the default terrain (Forest), then re-arm the
  // non-destructive Select tool so the next press selects rather than paints.
  await page.getByTestId('tool-terrain').click();
  await canvas.click();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');
  await page.getByTestId('tool-select').click();

  // Press on the painted hex and drag it ~100px to the right. Explicit
  // intermediate moves: the canvas drives the gesture off `pointermove`, so the
  // pointer must step across the threshold for the drag to register. The drag is
  // well past the ~69px column spacing, so it lands on a different hex.
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

  // In-page proof the move actually landed — a no-op gesture (selected but never
  // moved) would also leave the count at 1, so assert the destination directly:
  // completing the drag keeps the moved hex selected, at the specific destination
  // it landed on — a +100px drag at zoom 1 lands on q1·r0, well inside the
  // rounding margin — and the inspector still shows it as Forest. Pinning the
  // exact coordinate catches a move to the wrong hex, not merely "not the origin".
  await expect(page.getByTestId('entity-detail')).toHaveText('Forest');
  await expect(page.getByTestId('entity-coord')).toContainText('q 1 · r 0');

  // Save and wait on the real round-trip so the reload below can't race the PUT.
  const saved = page.waitForResponse(
    (res) =>
      res.request().method() === 'PUT' &&
      /\/api\/entities\/[\w-]+$/.test(res.url()) &&
      res.ok(),
  );
  await page.keyboard.press('ControlOrMeta+s');
  await saved;
  await expect(page.getByTestId('save-status')).toHaveText('Saved');

  // The persisted document holds one hex, no longer at the origin, still Forest:
  // the origin became Void and the destination took the moved content.
  const res = await request.get(`/api/entities/${mapId}`);
  expect(res.ok()).toBeTruthy();
  const detail = await res.json();
  const hexes = detail.document.hexes as Record<string, { terrain: string }>;
  expect(Object.keys(hexes)).toHaveLength(1);
  expect(hexes['0,0']).toBeUndefined();
  expect(hexes['1,0']).toEqual({ terrain: 'forest' });

  // The seam under test: a fresh load re-fetches and re-renders the moved map.
  // The origin is now Void (a click there selects nothing), and the destination
  // carries the re-rendered hex (clicking it opens the Hex panel).
  await page.reload();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');

  // Re-read the canvas box after the reload: its size and origin-centering are
  // re-applied on the fresh layout, so the pre-reload `box` may not match — using
  // it for the destination offset could round to a neighbouring hex.
  const box2 = await canvas.boundingBox();
  if (!box2) throw new Error('canvas not laid out after reload');

  await canvas.click({ position: { x: box2.width / 2, y: box2.height / 2 } });
  await expect(page.getByTestId('entity-coord')).toHaveCount(0);

  await canvas.click({ position: { x: box2.width / 2 + dx, y: box2.height / 2 } });
  await expect(page.getByTestId('entity-detail')).toHaveText('Forest');
});

/**
 * The non-destructive swap (issue #62, ADR-0017): dropping a Hex onto an occupied
 * hex exchanges the two whole records rather than overwriting, so a move never
 * silently destroys content. Like the move journey it rides the real canvas
 * press→drag gesture and proves the swap through the inspector, a direct API read,
 * and a reload — the two terrains end up exchanged at the two coordinates.
 */
test('drags a hex onto an occupied hex and swaps the two, surviving a reload', async ({
  page,
  request,
}) => {
  await page.goto('/entities');
  await page.getByTestId('new-map').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const mapId = page.url().split('/').pop();

  const canvas = page.getByRole('img', { name: 'Hex map' });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not laid out');
  const dx = 100; // a +100px drag at zoom 1 lands on the q1·r0 neighbour

  // Paint the centre hex Forest (the default terrain) ...
  await page.getByTestId('tool-terrain').click();
  await canvas.click();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');

  // ... then arm Ocean and paint the q1·r0 neighbour, so the drop target is occupied.
  await page
    .getByRole('group', { name: 'Terrain' })
    .getByRole('button', { name: 'Ocean' })
    .click();
  await canvas.click({ position: { x: box.width / 2 + dx, y: box.height / 2 } });
  await expect(page.getByTestId('hex-count')).toHaveText('2 hexes');

  // Arm Select and drag the Forest centre hex onto the occupied Ocean hex.
  await page.getByTestId('tool-select').click();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy);
  await page.mouse.move(cx + 80, cy);
  await page.mouse.move(cx + dx, cy);
  await page.mouse.up();

  // Nothing is destroyed or duplicated: still exactly two hexes. The dragged hex
  // landed at q1·r0 and stays selected, showing Forest there.
  await expect(page.getByTestId('hex-count')).toHaveText('2 hexes');
  await expect(page.getByTestId('entity-detail')).toHaveText('Forest');
  await expect(page.getByTestId('entity-coord')).toContainText('q 1 · r 0');

  // The occupant slid back to the origin: the centre now carries Ocean.
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(page.getByTestId('entity-detail')).toHaveText('Ocean');
  await expect(page.getByTestId('entity-coord')).toContainText('q 0 · r 0');

  // Persist, then read the saved document directly: the two records are exchanged.
  const saved = page.waitForResponse(
    (res) =>
      res.request().method() === 'PUT' &&
      /\/api\/entities\/[\w-]+$/.test(res.url()) &&
      res.ok(),
  );
  await page.keyboard.press('ControlOrMeta+s');
  await saved;
  await expect(page.getByTestId('save-status')).toHaveText('Saved');

  const res = await request.get(`/api/entities/${mapId}`);
  expect(res.ok()).toBeTruthy();
  const detail = await res.json();
  const hexes = detail.document.hexes as Record<string, { terrain: string }>;
  expect(hexes['0,0']).toEqual({ terrain: 'ocean' });
  expect(hexes['1,0']).toEqual({ terrain: 'forest' });

  // The swap re-renders intact after a fresh load.
  await page.reload();
  await expect(page.getByTestId('hex-count')).toHaveText('2 hexes');
  const box2 = await canvas.boundingBox();
  if (!box2) throw new Error('canvas not laid out after reload');
  await canvas.click({ position: { x: box2.width / 2, y: box2.height / 2 } });
  await expect(page.getByTestId('entity-detail')).toHaveText('Ocean');
  await canvas.click({ position: { x: box2.width / 2 + dx, y: box2.height / 2 } });
  await expect(page.getByTestId('entity-detail')).toHaveText('Forest');
});

/**
 * Escape aborts an in-progress Hex drag (issue #30 follow-up): the move is never
 * committed, so the hex stays at its origin and the destination stays Void. Like
 * the move journey this lives in e2e because it rides the real canvas press→drag
 * gesture (ADR-0003/0009).
 */
test('Escape cancels an in-progress Hex drag, leaving the hex at its origin', async ({
  page,
}) => {
  await page.goto('/entities');
  await page.getByTestId('new-map').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);

  const canvas = page.getByRole('img', { name: 'Hex map' });

  // Paint the centre hex (Forest) and arm Select.
  await page.getByTestId('tool-terrain').click();
  await canvas.click();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');
  await page.getByTestId('tool-select').click();

  // Begin dragging the hex ~100px to the right, then press Escape mid-drag —
  // before releasing — to abort the move.
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
  // Keep dragging *after* Escape with the pointer still held: the cancelled
  // gesture must not resume, so neither this continued travel nor the release
  // after it may start a fresh move.
  await page.mouse.move(cx + dx + 40, cy);
  await page.mouse.up();

  // The move never committed: still one hex. Cancelling a drag keeps the entity
  // selected, so the inspector still shows the origin hex without re-clicking it.
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');
  await expect(page.getByTestId('entity-coord')).toContainText('q 0');
  await expect(page.getByTestId('entity-detail')).toHaveText('Forest');

  // And the hex never moved: the drag destination is still Void.
  await canvas.click({ position: { x: box.width / 2 + dx, y: box.height / 2 } });
  await expect(page.getByTestId('entity-coord')).toHaveCount(0);
});

/**
 * The whole-group move (issue #64, ADR-0017): dragging a multi-hex Selection
 * translates *every* member by one offset in a single step, keeping the cluster's
 * shape. Like the single-hex journey it rides the real canvas press→drag gesture —
 * here a press on an already-selected member drags the whole set — and proves the
 * move through the count and a direct API read of the persisted document.
 */
test('drags a multi-hex selection so the whole group moves by one offset', async ({
  page,
  request,
}) => {
  await page.goto('/entities');
  await page.getByTestId('new-map').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const mapId = page.url().split('/').pop();

  const canvas = page.getByRole('img', { name: 'Hex map' });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not laid out');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = 100; // a +100px drag at zoom 1 spans one column (offset q+1)

  // Paint two adjacent hexes with distinct terrains: Forest at the centre (0,0) ...
  await page.getByTestId('tool-terrain').click();
  await canvas.click();
  // ... and Ocean at the q1·r0 neighbour.
  await page
    .getByRole('group', { name: 'Terrain' })
    .getByRole('button', { name: 'Ocean' })
    .click();
  await canvas.click({ position: { x: box.width / 2 + dx, y: box.height / 2 } });
  await expect(page.getByTestId('hex-count')).toHaveText('2 hexes');

  // Arm Select and build a two-hex Selection: click the centre, then Shift-click the
  // neighbour to add it. Both are now selected.
  await page.getByTestId('tool-select').click();
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await canvas.click({
    position: { x: box.width / 2 + dx, y: box.height / 2 },
    modifiers: ['Shift'],
  });

  // Press on a selected member and drag the whole set one column to the right.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy);
  await page.mouse.move(cx + 80, cy);
  await page.mouse.move(cx + dx, cy);
  await page.mouse.up();

  // The group moved rather than duplicated: still exactly two hexes.
  await expect(page.getByTestId('hex-count')).toHaveText('2 hexes');

  // Persist and read the saved document: each member rode by the same offset, so the
  // cluster kept its shape — Forest at q1·r0 and Ocean at q2·r0, the centre now Void.
  const saved = page.waitForResponse(
    (res) =>
      res.request().method() === 'PUT' &&
      /\/api\/entities\/[\w-]+$/.test(res.url()) &&
      res.ok(),
  );
  await page.keyboard.press('ControlOrMeta+s');
  await saved;
  await expect(page.getByTestId('save-status')).toHaveText('Saved');

  const res = await request.get(`/api/entities/${mapId}`);
  expect(res.ok()).toBeTruthy();
  const detail = await res.json();
  const hexes = detail.document.hexes as Record<string, { terrain: string }>;
  expect(hexes['0,0']).toBeUndefined();
  expect(hexes['1,0']).toEqual({ terrain: 'forest' });
  expect(hexes['2,0']).toEqual({ terrain: 'ocean' });
});

/**
 * A blocked group move is a no-op that snaps back (issue #64, ADR-0017): when a
 * member's destination is occupied by a non-selected hex that can only be displaced
 * onto the moving group's own path, the whole move is refused. Releasing leaves the
 * document untouched — nothing moves. Rides the real canvas press→drag gesture.
 */
test('refuses a blocked group move, leaving every hex where it was', async ({
  page,
  request,
}) => {
  await page.goto('/entities');
  await page.getByTestId('new-map').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const mapId = page.url().split('/').pop();

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
  await canvas.click({ position: { x: box.width / 2 + dx, y: box.height / 2 } });
  await terrain.getByRole('button', { name: 'Grassland' }).click();
  await canvas.click({ position: { x: box.width / 2 + dx2, y: box.height / 2 } });
  await expect(page.getByTestId('hex-count')).toHaveText('3 hexes');

  // Select only the first two (Forest + Ocean); leave Grassland out.
  await page.getByTestId('tool-select').click();
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await canvas.click({
    position: { x: box.width / 2 + dx, y: box.height / 2 },
    modifiers: ['Shift'],
  });

  // Drag the pair one column right: Ocean would land on Grassland, which could only
  // be pushed onto where Forest is landing — a self-overlapping nudge that blocks.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy);
  await page.mouse.move(cx + 80, cy);
  await page.mouse.move(cx + dx, cy);
  await page.mouse.up();

  // The move was refused: still three hexes, and nothing budged.
  await expect(page.getByTestId('hex-count')).toHaveText('3 hexes');

  // The refusal is surfaced to the user as a visible toast explaining why it
  // wouldn't land (announced to assistive tech via the CDK live region).
  await expect(page.locator('.toast', { hasText: 'Move blocked' })).toBeVisible();

  const saved = page.waitForResponse(
    (res) =>
      res.request().method() === 'PUT' &&
      /\/api\/entities\/[\w-]+$/.test(res.url()) &&
      res.ok(),
  );
  await page.keyboard.press('ControlOrMeta+s');
  await saved;
  await expect(page.getByTestId('save-status')).toHaveText('Saved');

  const res = await request.get(`/api/entities/${mapId}`);
  expect(res.ok()).toBeTruthy();
  const detail = await res.json();
  const hexes = detail.document.hexes as Record<string, { terrain: string }>;
  // Every hex is exactly where it was painted — the blocked move changed nothing.
  expect(hexes['0,0']).toEqual({ terrain: 'forest' });
  expect(hexes['1,0']).toEqual({ terrain: 'ocean' });
  expect(hexes['2,0']).toEqual({ terrain: 'grass' });
});
