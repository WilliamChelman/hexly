import { enterLibrary, expect, test } from './fixtures';
import type { Page } from '@playwright/test';

/**
 * The floating Dock over a reading-column View (ADR-0067): an open Panel must never cover the column —
 * pushed clear when the viewport is too narrow to float the Dock, left unmoved when there is room.
 * Regression guard: a container-query bug once set the inset on the query container itself, so the push
 * never fired.
 */

async function newNote(page: Page) {
  await enterLibrary(page);
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

test('a narrow viewport pushes the reading column clear of an open Panel', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 }); // within the 48–109rem push range
  await newNote(page);

  await page.getByTestId('references-toggle').click();
  await expect(page.getByTestId('dock-panel')).toBeVisible();

  // Poll past the inset's 200ms transition before comparing.
  await expect.poll(async () => (await edges(page)).contentRight <= (await edges(page)).panelLeft).toBe(true);
});

test('a wide viewport floats the Panel over the whitespace without shifting the column', async ({ page }) => {
  await page.setViewportSize({ width: 1900, height: 900 }); // past 109rem — room to float
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
