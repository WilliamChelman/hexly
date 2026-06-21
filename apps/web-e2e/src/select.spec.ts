import { expect, test } from './fixtures';

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
 * on hex (0,0); a click near a corner lands on a far, Void coordinate.
 */

/** A new map, opened in its editor; returns the canvas locator and the map id. */
async function newMap(page: import('@playwright/test').Page) {
  await page.goto('/maps');
  await page.getByTestId('new-map').click();
  await expect(page).toHaveURL(/\/maps\/[\w-]+$/);
  const mapId = page.url().split('/').pop() as string;
  const canvas = page.getByRole('img', { name: 'Hex map' });
  return { canvas, mapId };
}

test('under Select, clicking a painted Hex inspects it and clicking empty space clears it', async ({
  page,
}) => {
  const { canvas } = await newMap(page);

  // Paint the centre hex (default terrain, Forest), then re-arm the
  // non-destructive Select tool.
  await page.getByTestId('tool-terrain').click();
  await canvas.click();
  await expect(page.getByTestId('hex-count')).toHaveText('1 hex');
  await page.getByTestId('tool-select').click();

  // Clicking the painted hex selects it: the inspector shows the Hex panel with
  // its coordinate and terrain, and no Label editor.
  await canvas.click();
  await expect(page.getByTestId('entity-coord')).toContainText('q 0');
  await expect(page.getByTestId('entity-detail')).toHaveText('Forest');
  await expect(page.getByTestId('label-text')).toHaveCount(0);

  // Clicking a far, Void coordinate with no label hit deselects (the inspector
  // falls back to its empty-state hint).
  await canvas.click({ position: { x: 24, y: 24 } });
  await expect(page.getByTestId('entity-coord')).toHaveCount(0);
});

test('under Select, clicking a Feature selects the Feature, not the Hex beneath it', async ({
  page,
}) => {
  const { canvas } = await newMap(page);

  // A Feature rides on a Hex, so paint the centre hex first, then place a
  // Settlement on it.
  await page.getByTestId('tool-terrain').click();
  await canvas.click();
  await page.getByTestId('tool-feature').click();
  await page
    .getByRole('group', { name: 'Features' })
    .getByRole('button', { name: 'Settlement' })
    .click();
  await canvas.click();

  // Under Select, clicking that hex selects the Feature over the Hex: the panel
  // is labelled as a feature and shows the feature's identity.
  await page.getByTestId('tool-select').click();
  await canvas.click();
  await expect(page.locator('header')).toContainText('feature');
  await expect(page.getByTestId('entity-detail')).toHaveText('Settlement');
});

test('under Select, clicking a Label floating over a painted hex selects the Label', async ({
  page,
}) => {
  const { canvas } = await newMap(page);

  // Paint the centre hex, then drop a Label at that same point so the label
  // floats over a painted hex.
  await page.getByTestId('tool-terrain').click();
  await canvas.click();
  await page.getByTestId('tool-label').click();
  await canvas.click();

  // Deselect (the drop auto-selected the new label), then click the same point
  // under Select. Label wins the precedence over the painted hex beneath it, so
  // the Label editor — not the Hex panel — opens.
  await page.getByTestId('tool-select').click();
  await canvas.click({ position: { x: 24, y: 24 } });
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

  // Clear the auto-selection so a stray Label editor can't mask the result.
  await page.getByTestId('tool-select').click();
  await canvas.click({ position: { x: 24, y: 24 } });
  await expect(page.getByTestId('label-text')).toHaveCount(0);

  // Arm Terrain → Ocean and click right where the Label floats. The Label is
  // inert to painting Tools (issue #28): the click paints the hex beneath rather
  // than selecting or grabbing the Label, so no Label editor opens.
  await page.getByTestId('tool-terrain').click();
  await page
    .getByRole('group', { name: 'Terrain' })
    .getByRole('button', { name: 'Ocean' })
    .click();
  await canvas.click();
  await expect(page.getByTestId('label-text')).toHaveCount(0);

  // Save and read back: the hex beneath the Label took the new terrain, and the
  // Label still exists (it was never moved or deleted).
  const saved = page.waitForResponse(
    (res) =>
      res.request().method() === 'PUT' &&
      /\/api\/maps\/[\w-]+$/.test(res.url()) &&
      res.ok(),
  );
  await page.getByTestId('save').click();
  await saved;

  const res = await request.get(`/api/maps/${mapId}`);
  expect(res.ok()).toBeTruthy();
  const detail = await res.json();
  const hexes = Object.values(detail.document.hexes) as Array<{ terrain: string }>;
  expect(hexes).toHaveLength(1);
  expect(hexes[0].terrain).toBe('ocean');
  expect(detail.document.labels).toHaveLength(1);
});

test('under Select, dragging a selected Label repositions it', async ({ page }) => {
  const { canvas } = await newMap(page);

  // Drop a Label at the centre, arm Select, and deselect so the grab below is a
  // genuine universal-select press, not a leftover selection.
  await page.getByTestId('tool-label').click();
  await canvas.click();
  const startX = Number(await page.getByTestId('label-x').inputValue());
  await page.getByTestId('tool-select').click();
  await canvas.click({ position: { x: 24, y: 24 } });
  await expect(page.getByTestId('label-x')).toHaveCount(0);

  // Press on the label and drag it ~120px to the right across the canvas. At
  // zoom 1 a screen pixel is a world pixel, so its X should grow by roughly that
  // much. Explicit intermediate moves: the canvas drives the drag off
  // `pointermove`, so step the pointer across so each move is observed.
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

  // The press grabbed the label (it is selected again) and the drag moved it.
  // Poll the inspector's X field: the move commits in the pointerup handler and
  // the inspector reflects it on the next change-detection tick, so a one-shot
  // read can race ahead of that update.
  await expect(page.getByTestId('label-x')).toHaveCount(1);
  await expect
    .poll(async () => Number(await page.getByTestId('label-x').inputValue()))
    .toBeGreaterThan(startX + 50);
});
