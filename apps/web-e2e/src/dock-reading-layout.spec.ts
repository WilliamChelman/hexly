import { enterEntities, expect, test, widenDockPanel } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * The floating Dock over a reading-column View (ADR-0067): an open Panel must never cover the column —
 * pushed clear when the viewport is too narrow to float the Dock, left unmoved when there is room.
 * Regression guard: a container-query bug once set the inset on the query container itself, so the push
 * never fired.
 */

async function newNote(page: Page) {
  await enterEntities(page);
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  await expect(page.getByTestId('note-content')).toBeVisible();
}

/** Right edge of the content vs left edge of the open Panel — must not cross. */
async function edges(page: Page) {
  const content = await page.getByTestId('note-content').boundingBox();
  const panel = await page.getByTestId('dock-panel').boundingBox();
  if (!content || !panel) throw new Error('content or panel not laid out');
  return { contentRight: content.x + content.width, panelLeft: panel.x };
}

async function panelWidth(page: Page) {
  const panel = await page.getByTestId('dock-panel').boundingBox();
  if (!panel) throw new Error('panel not laid out');
  return panel.width;
}

test('a narrow viewport pushes the reading column clear of an open Panel', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 }); // narrow enough that the Dock pushes rather than floats
  await newNote(page);

  await page.getByTestId('references-toggle').click();
  await expect(page.getByTestId('dock-panel')).toBeVisible();

  // Poll past the inset's 200ms transition before comparing.
  await expect.poll(async () => (await edges(page)).contentRight <= (await edges(page)).panelLeft).toBe(true);
});

test('a wide viewport floats the Panel over the whitespace without shifting the column', async ({ page }) => {
  await page.setViewportSize({ width: 1900, height: 900 }); // wide enough to float the Dock in the column's whitespace
  await newNote(page);

  const before = await page.getByTestId('note-content').boundingBox();

  await page.getByTestId('references-toggle').click();
  await expect(page.getByTestId('dock-panel')).toBeVisible();

  // The Panel floats over the right whitespace: no overlap, and the column has not moved.
  const { contentRight, panelLeft } = await edges(page);
  expect(contentRight).toBeLessThanOrEqual(panelLeft);
  const after = await page.getByTestId('note-content').boundingBox();
  expect(after?.x).toBeCloseTo(before?.x ?? -1, 0);
});

test('the grip resizes the Panel, and the width is remembered across a reload', async ({ page }) => {
  await page.setViewportSize({ width: 1900, height: 900 });
  await newNote(page);

  await page.getByTestId('references-toggle').click();
  await expect(page.getByTestId('dock-panel')).toBeVisible();
  const before = await panelWidth(page);

  await widenDockPanel(page, 120);
  const widened = await panelWidth(page);
  expect(widened).toBeGreaterThan(before + 100);

  await page.reload();
  await expect(page.getByTestId('dock-panel')).toBeVisible();
  expect(await panelWidth(page)).toBeCloseTo(widened, 0);
});

/**
 * The width is remembered, so it outlives the window it was chosen in: a Panel dragged wide on a big
 * screen must not, on a small one, reserve the column away or carry its own grip out through the body's
 * clipped edge — which is how a fixed give-up breakpoint and a viewport-blind clamp had left it.
 */
test('a Panel wider than the window keeps a readable column and a reachable grip', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await newNote(page);

  await page.getByTestId('references-toggle').click();
  await widenDockPanel(page, 400); // past the Dock's 640px bound, so it settles there
  expect(await panelWidth(page)).toBe(640);

  await page.setViewportSize({ width: 600, height: 900 });

  // Poll past the reflow and the inset's transition. Uncapped, the reserve would be the Panel's whole
  // 45.5rem footprint on a 34.5rem body — a column of nothing.
  await expect
    .poll(async () => (await page.getByTestId('note-content').boundingBox())?.width ?? 0)
    .toBeGreaterThan(150);
  const grip = await page.getByTestId('dock-resize').boundingBox();
  expect(grip?.x ?? -1).toBeGreaterThanOrEqual(0); // the Panel gave way rather than sliding out of the body
});

test('a widened Panel pushes the reading column further clear', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 }); // narrow enough that the Dock pushes
  await newNote(page);

  await page.getByTestId('references-toggle').click();
  await expect(page.getByTestId('dock-panel')).toBeVisible();

  await widenDockPanel(page, 120);

  // The reserved inset follows the width, so the column clears the wider Panel too.
  await expect.poll(async () => (await edges(page)).contentRight <= (await edges(page)).panelLeft).toBe(true);
});
