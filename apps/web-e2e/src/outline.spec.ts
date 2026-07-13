import { enterLibrary, expect, flushSave, test } from './fixtures';
import type { Page } from '@playwright/test';

/** The Outline panel end-to-end, driven with real TipTap keyboard input (markdown `# ` input rules). */

/** Create a fresh note and land on its editor surface, returning the content locator. */
async function newNote(page: Page) {
  await enterLibrary(page);
  await page.getByTestId('new-note').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const surface = page.getByTestId('note-content');
  await surface.click();
  return surface;
}

/** Type a heading of the given level (markdown shortcut), then drop to a new line. */
async function typeHeading(page: Page, level: number, text: string) {
  await page.keyboard.type(`${'#'.repeat(level)} ${text}`);
  await page.keyboard.press('Enter');
}

test('lists the note’s headings, in order, once opened', async ({ page }) => {
  await newNote(page);
  await typeHeading(page, 1, 'The Reach');
  await page.keyboard.type('Ruled by Lady Mara.');
  await page.keyboard.press('Enter');
  await typeHeading(page, 2, 'History');
  await typeHeading(page, 2, 'Geography');

  await page.getByTestId('outline-toggle').click();

  await expect(page.getByTestId('outline-item')).toHaveText(['The Reach', 'History', 'Geography']);
});

test('shows an empty state for a note with no headings', async ({ page }) => {
  await newNote(page);
  await page.keyboard.type('Just some prose, no headings at all.');

  await page.getByTestId('outline-toggle').click();

  await expect(page.getByTestId('outline-empty')).toBeVisible();
  await expect(page.getByTestId('outline-item')).toHaveCount(0);
});

test('clicking an item scrolls that heading into view', async ({ page }) => {
  const surface = await newNote(page);
  await typeHeading(page, 1, 'Alpha');
  // Enough prose to push the top heading well out of the viewport.
  for (let i = 0; i < 25; i++) {
    await page.keyboard.type(`Filler line number ${i} of the northern reach.`);
    await page.keyboard.press('Enter');
  }
  await typeHeading(page, 1, 'Omega');

  const alpha = surface.getByRole('heading', { name: 'Alpha', exact: true });

  // Force the scroll port to the bottom so Alpha is definitively off-screen first.
  await page.evaluate(() => document.querySelector('[data-content-scroll]')?.scrollTo(0, 1e6));
  await expect(alpha).not.toBeInViewport();

  await page.getByTestId('outline-toggle').click();
  await page.getByTestId('outline-item').filter({ hasText: 'Alpha' }).click();

  await expect(alpha).toBeInViewport();
});

test('remembers the open state across a reload', async ({ page }) => {
  await newNote(page);
  await typeHeading(page, 1, 'Kept Open');
  await flushSave(page); // persist the heading so it survives the reload too

  await page.getByTestId('outline-toggle').click();
  await expect(page.getByTestId('outline-item')).toHaveText(['Kept Open']);

  await page.reload();

  // Open immediately on load — no second click — because the choice persisted (localStorage).
  await expect(page.getByTestId('outline-toggle')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('outline-item')).toHaveText(['Kept Open']);
});
