import { enterLibrary, entityIdFromUrl, expect, flushSave, test } from './fixtures';

/**
 * The universal Select journey (issue #28, ADR-0010). These cross the one seam
 * the store/renderer/inspector unit tests cannot reach: real pointer input on
 * the Canvas, where the canvas turns a click into the geometric inputs (the hex
 * under the pointer and the label hit) it hands to the store. Map state lives as
 * Canvas pixels (ADR-0003), so we observe selection through the inspector panel
 * the selection drives, and prove paint-beneath with a direct API read of the
 * persisted document (ADR-0009).
 *
 * The canvas centres the world origin on load, so a plain `canvas.click()` lands
 * on hex (0,0); {@link clickVoid} lands on a far, Void coordinate clear of the
 * floating chrome.
 */

/** A new map, opened in its editor; returns the canvas locator and the map id. */
async function newMap(page: import('@playwright/test').Page) {
  await enterLibrary(page);
  await page.getByTestId('new-map').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const mapId = entityIdFromUrl(page);
  const canvas = page.getByRole('img', { name: 'Hex map' });
  return { canvas, mapId };
}

/**
 * Click a far, Void coordinate with no label hit, to deselect. The canvas is
 * full-bleed with the chrome floating over it (ADR-0013), so the corners are no
 * longer empty: the tool palette sits top-left, the rail/inspector top-right, the
 * coordinate readout bottom-left and the zoom controls bottom-right. The
 * top-centre strip is clear, and far above the centred origin, so a click there
 * lands on the canvas (not a button) and on a Void hex.
 */
async function clickVoid(canvas: import('@playwright/test').Locator) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not laid out');
  await canvas.click({ position: { x: box.width / 2, y: 24 } });
}

test('under Select, clicking a painted Hex inspects it and clicking empty space clears it', async ({
  page,
}) => {
  const { canvas } = await newMap(page);

  await page.getByTestId('tool-terrain').click();
  await canvas.click();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');
  await page.getByTestId('tool-select').click();

  await canvas.click();
  await expect(page.getByTestId('entity-coord')).toContainText('q 0');
  await expect(page.getByTestId('entity-detail')).toHaveText('Forest');
  await expect(page.getByTestId('label-text')).toHaveCount(0);

  // Clicking Void with no label hit deselects.
  await clickVoid(canvas);
  await expect(page.getByTestId('entity-coord')).toHaveCount(0);
});

test('under Select, clicking a Feature selects the Feature, not the Hex beneath it', async ({
  page,
}) => {
  const { canvas } = await newMap(page);

  await page.getByTestId('tool-terrain').click();
  await canvas.click();
  await page.getByTestId('tool-feature').click();
  await page
    .getByRole('group', { name: 'Features' })
    .getByRole('button', { name: 'Settlement' })
    .click();
  await canvas.click();

  // Under Select, Features have priority over the Hex beneath.
  await page.getByTestId('tool-select').click();
  await canvas.click();
  await expect(page.locator('header')).toContainText('feature');
  await expect(page.getByTestId('entity-detail')).toHaveText('Settlement');
});

test('under Select, clicking a Label floating over a painted hex selects the Label', async ({
  page,
}) => {
  const { canvas } = await newMap(page);

  // Paint centre hex, then drop a Label at that same point.
  await page.getByTestId('tool-terrain').click();
  await canvas.click();
  await page.getByTestId('tool-label').click();
  await canvas.click();

  // Deselect (drop auto-selects), then click under Select. Labels have priority.
  await page.getByTestId('tool-select').click();
  await clickVoid(canvas);
  await expect(page.getByTestId('label-text')).toHaveCount(0);

  await canvas.click();
  await expect(page.getByTestId('label-text')).toHaveCount(1);
  await expect(page.getByTestId('entity-coord')).toHaveCount(0);
});

test('a painting Tool over a floating Label paints the hex beneath instead of grabbing it', async ({
  page,
  request,
}) => {
  const { canvas, mapId } = await newMap(page);

  // Paint Forest at the centre and float a Label over it.
  await page.getByTestId('tool-terrain').click();
  await canvas.click();
  await page.getByTestId('tool-label').click();
  await canvas.click();

  // Record Label position to prove the painting Tool didn't move it.
  const labelX = Number(await page.getByTestId('label-x').inputValue());
  const labelY = Number(await page.getByTestId('label-y').inputValue());

  // Clear selection.
  await page.getByTestId('tool-select').click();
  await clickVoid(canvas);
  await expect(page.getByTestId('label-text')).toHaveCount(0);

  // Arm Terrain → Ocean. Labels are inert to painting Tools (issue #28):
  // the click paints the hex beneath rather than moving or selecting the Label.
  await page.getByTestId('tool-terrain').click();
  await page
    .getByRole('group', { name: 'Terrain' })
    .getByRole('button', { name: 'Ocean' })
    .click();
  await canvas.click();
  await expect(page.getByTestId('label-text')).toHaveCount(0);

  await flushSave(page);

  const res = await request.get(`/api/entities/${mapId}`);
  expect(res.ok()).toBeTruthy();
  const detail = await res.json();
  const hexes = Object.values(detail.document.hexes) as Array<{ terrain: string }>;
  expect(hexes).toHaveLength(1);
  expect(hexes[0].terrain).toBe('ocean');
  // Label survived and stayed put.
  const labels = detail.document.labels as Array<{ position: { x: number; y: number } }>;
  expect(labels).toHaveLength(1);
  expect(labels[0].position.x).toBeCloseTo(labelX, 1);
  expect(labels[0].position.y).toBeCloseTo(labelY, 1);
});

test('Cmd/Ctrl-click adds a second entity to the Selection, shown in the Inspector', async ({
  page,
}) => {
  const { canvas } = await newMap(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not laid out');
  const cx = box.width / 2;
  const cy = box.height / 2;

  await page.getByTestId('tool-terrain').click();
  await canvas.click({ position: { x: cx, y: cy } });
  await canvas.click({ position: { x: cx + 70, y: cy } });
  await expect(page.getByTestId('hex-count')).toHaveText('2 hexes');

  await page.getByTestId('tool-select').click();
  await canvas.click({ position: { x: cx, y: cy } });
  await expect(page.getByTestId('entity-coord')).toBeVisible();

  // Cmd/Ctrl-click adds to the Selection, showing the count + Delete all (ADR-0017).
  await canvas.click({
    position: { x: cx + 70, y: cy },
    modifiers: ['ControlOrMeta'],
  });
  await expect(page.getByTestId('selection-count')).toContainText('2');
  await expect(page.getByTestId('selection-delete-all')).toBeVisible();
  await expect(page.getByTestId('entity-coord')).toHaveCount(0);
});

test('holding Cmd/Ctrl and dragging sweeps several hexes into the Selection', async ({
  page,
}) => {
  const { canvas } = await newMap(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not laid out');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Paint a row of three adjacent hexes.
  await page.getByTestId('tool-terrain').click();
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await canvas.click({ position: { x: box.width / 2 + 70, y: box.height / 2 } });
  await canvas.click({ position: { x: box.width / 2 + 140, y: box.height / 2 } });
  await expect(page.getByTestId('hex-count')).toHaveText('3 hexes');

  // Hold Cmd/Ctrl and drag across the row (ADR-0017).
  await page.getByTestId('tool-select').click();
  await page.keyboard.down('ControlOrMeta');
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 70, cy);
  await page.mouse.move(cx + 140, cy);
  await page.mouse.up();
  await page.keyboard.up('ControlOrMeta');

  await expect(page.getByTestId('selection-count')).toContainText('3');
});

test('Delete removes the whole multi-selection in one gesture', async ({
  page,
}) => {
  const { canvas } = await newMap(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not laid out');
  const cx = box.width / 2;
  const cy = box.height / 2;

  await page.getByTestId('tool-terrain').click();
  await canvas.click({ position: { x: cx, y: cy } });
  await canvas.click({ position: { x: cx + 70, y: cy } });
  await expect(page.getByTestId('hex-count')).toHaveText('2 hexes');

  await page.getByTestId('tool-select').click();
  await canvas.click({ position: { x: cx, y: cy } });
  await canvas.click({
    position: { x: cx + 70, y: cy },
    modifiers: ['ControlOrMeta'],
  });
  await expect(page.getByTestId('selection-count')).toContainText('2');

  // Delete erases the entire selection at once.
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('hex-count')).toHaveText('0 hexes');
});

test('under Select, dragging a selected Label repositions it', async ({ page }) => {
  const { canvas } = await newMap(page);

  // Drop a Label at the centre, arm Select, and deselect so the grab below is a
  // genuine universal-select press, not a leftover selection.
  await page.getByTestId('tool-label').click();
  await canvas.click();
  const startX = Number(await page.getByTestId('label-x').inputValue());
  const startY = Number(await page.getByTestId('label-y').inputValue());
  await page.getByTestId('tool-select').click();
  await clickVoid(canvas);
  await expect(page.getByTestId('label-x')).toHaveCount(0);

  // Drag ~120px right. At zoom 1 a screen pixel is a world pixel.
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not laid out');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy);
  await page.mouse.move(cx + 80, cy);
  await page.mouse.move(cx + 120, cy);
  await page.mouse.up();

  // The drag moved it; poll for the update in the inspector.
  await expect(page.getByTestId('label-x')).toHaveCount(1);
  await expect
    .poll(async () => Number(await page.getByTestId('label-x').inputValue()))
    .toBeGreaterThan(startX + 100);
  expect(Number(await page.getByTestId('label-x').inputValue())).toBeLessThan(
    startX + 140,
  );
  expect(Number(await page.getByTestId('label-y').inputValue())).toBeCloseTo(
    startY,
    0,
  );
});

/**
 * The Marquee Subtool journey (issue #63, ADR-0017). It crosses the one seam the
 * store/renderer unit tests cannot reach: the real canvas drag, where a press in
 * select+marquee draws a live rectangle and the release runs the pure marquee
 * hit-test over the document and folds the contained Hexes and Labels into the
 * Selection. Marquee works *over painted hexes* — where a pick-drag would instead
 * move a hex — so the box here starts on a painted hex and must select, never move.
 */
test('Marquee box-selects the hexes and a label inside it, dragging over painted hexes', async ({
  page,
}) => {
  const { canvas } = await newMap(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not laid out');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Paint the centre hex (0,0) and its east neighbour (~70px right at zoom 1).
  await page.getByTestId('tool-terrain').click();
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await canvas.click({ position: { x: box.width / 2 + 70, y: box.height / 2 } });
  await expect(page.getByTestId('hex-count')).toHaveText('2 hexes');

  // Float a Label between them.
  await page.getByTestId('tool-label').click();
  await canvas.click({ position: { x: box.width / 2 + 35, y: box.height / 2 } });

  // Drag Marquee box over painted hexes and label (~8px offset keeps the hex inside).
  await page.getByTestId('tool-select').click();
  await page.getByTestId('select-marquee').click();
  await page.mouse.move(cx - 8, cy - 8);
  await page.mouse.down();
  await page.mouse.move(cx + 55, cy + 5);
  await page.mouse.move(cx + 110, cy + 20);
  await page.mouse.up();

  // Selected all three (ADR-0017); hexes stayed put (Marquee, not Pick).
  await expect(page.getByTestId('selection-count')).toContainText('3');
  await expect(page.getByTestId('selection-delete-all')).toBeVisible();
  await expect(page.getByTestId('hex-count')).toHaveText('2 hexes');
});

/**
 * A Shift-marquee adds its box to the Selection instead of replacing it, so
 * several boxes accumulate (issue #63, ADR-0017). A plain marquee first selects
 * one hex; a Shift-marquee over the other two grows the set to all three.
 */
test('Shift-marquee adds a second box to the Selection rather than replacing it', async ({
  page,
}) => {
  const { canvas } = await newMap(page);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not laid out');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Paint a row of three adjacent hexes.
  await page.getByTestId('tool-terrain').click();
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await canvas.click({ position: { x: box.width / 2 + 70, y: box.height / 2 } });
  await canvas.click({ position: { x: box.width / 2 + 140, y: box.height / 2 } });
  await expect(page.getByTestId('hex-count')).toHaveText('3 hexes');

  // Plain box around first hex selects just it.
  await page.getByTestId('tool-select').click();
  await page.getByTestId('select-marquee').click();
  await page.mouse.move(cx - 30, cy - 30);
  await page.mouse.down();
  await page.mouse.move(cx + 30, cy + 30);
  await page.mouse.up();
  await expect(page.getByTestId('entity-coord')).toContainText('q 0');

  // Shift-marquee adds the other two rather than replacing.
  await page.keyboard.down('Shift');
  await page.mouse.move(cx + 45, cy - 30);
  await page.mouse.down();
  await page.mouse.move(cx + 170, cy + 30);
  await page.mouse.up();
  await page.keyboard.up('Shift');

  await expect(page.getByTestId('selection-count')).toContainText('3');
});
