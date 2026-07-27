import type { Locator, Page } from '@playwright/test';
import { rasteriseColors } from '@hexly/web-styles';
import { enterLibrary, entityIdFromUrl, expect, flushSave, test } from './fixtures';

/**
 * The World Graph journey (#181), and its generic show-orphans toggle (ADR-0065, #283). A linked
 * pair draws by default; a link-less Entity — any type, an unreferenced Asset chief among them — is
 * an orphan the graph hides until the toggle asks for it.
 */
test('hides orphan entities behind a generic show-orphans toggle', async ({ page }) => {
  const worldId = await enterLibrary(page);

  // The link target: a note the source can point at.
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  const targetId = entityIdFromUrl(page);

  // The source note, linked to the target via an @-mention — one edge, two non-orphan nodes.
  await enterLibrary(page);
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);
  await page.getByTestId('note-content').click();
  await page.keyboard.type('@');
  await expect(page.getByTestId('entity-picker')).toBeVisible();
  await page.getByTestId(`entity-picker-option-${targetId}`).click();
  await expect(page.getByTestId('entity-link')).toBeVisible();
  await flushSave(page);

  // A third note left unlinked — the orphan.
  await enterLibrary(page);
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);

  await page.goto(`/w/${worldId}/graph`);

  // Default: only the linked pair is drawn; the orphan is counted out.
  const counts = page.getByTestId('graph-counts');
  await expect(counts).toContainText('2 entities');
  await expect(counts).toContainText('1 links');

  // The toggle lives in the graph's floating filters menu, which closes on select — so reading its
  // state means opening the menu again.
  const filters = page.getByTestId('graph-filters');
  await filters.click();
  const toggle = page.getByTestId('graph-orphans-toggle');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');

  // Flip it: the orphan joins the picture, the edge count holds.
  await toggle.click();
  await expect(counts).toContainText('3 entities');
  await expect(counts).toContainText('1 links');
  await filters.click();
  await expect(page.getByTestId('graph-orphans-toggle')).toHaveAttribute('aria-checked', 'true');
});

/**
 * The colour the drawing is actually painted on, as composited. cosmos.gl's WebGL context is not
 * `preserveDrawingBuffer`, so the canvas answers nothing when sampled in-page — a screenshot is the only
 * reading of it a reader would recognise.
 *
 * The modal pixel rather than a chosen one: the field is by far the largest thing in a sparse graph, so
 * nothing has to guess where the layout left a gap.
 */
async function fieldColor(page: Page, canvas: Locator): Promise<number[]> {
  const shot = (await canvas.screenshot()).toString('base64');
  return page.evaluate(async (encoded) => {
    const blob = await (await fetch(`data:image/png;base64,${encoded}`)).blob();
    const bitmap = await createImageBitmap(blob);
    const surface = document.createElement('canvas');
    surface.width = bitmap.width;
    surface.height = bitmap.height;
    const context = surface.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('no 2d context');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, surface.width, surface.height).data;
    const tally = new Map<number, number>();
    for (let i = 0; i < pixels.length; i += 4) {
      const packed = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
      tally.set(packed, (tally.get(packed) ?? 0) + 1);
    }
    let field = 0;
    let most = -1;
    for (const [packed, count] of tally) if (count > most) [field, most] = [packed, count];
    return [(field >> 16) & 255, (field >> 8) & 255, field & 255];
  }, shot);
}

/**
 * The graph's field is `--color-surface-sunken`, judged at the pixels.
 *
 * Nothing weaker sees this. Tier 2 derives, so the token resolves to `oklch()` (ADR-0075), and cosmos.gl
 * — a WebGL renderer that parses colour strings itself, with d3-color — answers black to a notation it
 * does not know. Every guard that stops at the resolved *value* passes such a colour: the token snapshot
 * accepts `oklch(` as resolved, and its rasterise reads through a 2D context, which parses `oklch()`
 * happily. Only the drawing knows what the renderer made of it.
 *
 * One orphan Entity, shown through the filter: the fewer nodes, the less of the field they cover.
 */
test('draws on the sunken surface rather than on black', async ({ page }) => {
  const worldId = await enterLibrary(page);
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);

  await page.goto(`/w/${worldId}/graph`);
  await page.getByTestId('graph-filters').click();
  await page.getByTestId('graph-orphans-toggle').click();

  const canvas = page.getByTestId('graph-canvas');
  await expect(canvas.locator('canvas')).toBeVisible();

  const sunken = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--color-surface-sunken').trim(),
  );
  // The expected colour comes from the live token through the same rasterise the contrast report uses,
  // so the assertion holds in whichever ColorScheme the suite is painted in.
  const [expected] = await page.evaluate(rasteriseColors, [sunken]);
  const field = await fieldColor(page, canvas);

  // One 8-bit step of slack, for the trip through the GPU's unorm conversion and the screenshot's encode.
  const drifted = field.filter((channel, i) => Math.abs(channel - expected[i]) > 1);
  expect(drifted, `the field reads ${field} where ${sunken} rasterises to ${expected}`).toEqual([]);
});
