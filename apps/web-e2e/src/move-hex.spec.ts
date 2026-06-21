import { expect, test } from './fixtures';

/**
 * The whole-Hex move journey (issue #30, ADR-0010). It crosses the one seam the
 * store unit tests cannot reach: the canvas press→drag-threshold gesture, where a
 * press over a selected hex arms a move and crossing a small pixel threshold turns
 * it into a `moveHex`, committed once on release. Like the other canvas journeys
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
  await page.goto('/maps');
  await page.getByTestId('new-map').click();
  await expect(page).toHaveURL(/\/maps\/[\w-]+$/);
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

  // Save and wait on the real round-trip so the reload below can't race the PUT.
  const saved = page.waitForResponse(
    (res) =>
      res.request().method() === 'PUT' &&
      /\/api\/maps\/[\w-]+$/.test(res.url()) &&
      res.ok(),
  );
  await page.getByTestId('save').click();
  await saved;
  await expect(page.getByTestId('save')).toHaveText('Save');

  // The persisted document holds one hex, no longer at the origin, still Forest:
  // the origin became Void and the destination took the moved content.
  const res = await request.get(`/api/maps/${mapId}`);
  expect(res.ok()).toBeTruthy();
  const detail = await res.json();
  const hexes = detail.document.hexes as Record<string, { terrain: string }>;
  expect(Object.keys(hexes)).toHaveLength(1);
  expect(hexes['0,0']).toBeUndefined();
  expect(Object.values(hexes)[0].terrain).toBe('forest');

  // The seam under test: a fresh load re-fetches and re-renders the moved map.
  // The origin is now Void (a click there selects nothing), and the destination
  // carries the re-rendered hex (clicking it opens the Hex panel).
  await page.reload();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');

  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(page.getByTestId('entity-coord')).toHaveCount(0);

  await canvas.click({ position: { x: box.width / 2 + dx, y: box.height / 2 } });
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
  await page.goto('/maps');
  await page.getByTestId('new-map').click();
  await expect(page).toHaveURL(/\/maps\/[\w-]+$/);

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
