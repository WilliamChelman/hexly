import type { Locator } from '@playwright/test';
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
 * The colour `canvas` is painted, as composited — via a screenshot, because cosmos.gl's WebGL context is
 * not `preserveDrawingBuffer` and so answers nothing sampled in-page. The modal pixel, since the
 * background is the largest thing in a sparse graph and no one spot is known to be clear of nodes.
 *
 * The `<canvas>` itself, never the div around it: cosmos.gl mirrors the same colour onto that div's CSS
 * `background-color`, which a CSS parser would resolve — the very thing this has to see past.
 */
async function paintedBackground(canvas: Locator): Promise<[number, number, number]> {
  const shot = (await canvas.screenshot()).toString('base64');
  return canvas.page().evaluate(async (encoded) => {
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
    let painted = 0;
    let most = -1;
    for (const [packed, count] of tally) if (count > most) [painted, most] = [packed, count];
    return [(painted >> 16) & 255, (painted >> 8) & 255, painted & 255] as [number, number, number];
  }, shot);
}

/**
 * The graph draws on `--color-surface-sunken`, judged at the pixels — the only reading that sees what a
 * WebGL renderer made of a colour. Tier 2 derives, so the token resolves to `oklch()` (ADR-0075), and
 * cosmos.gl parses colour strings itself and answers black to a notation it does not know; every guard
 * that stops at the resolved *value* passes such a colour, including the token snapshot's own rasterise.
 */
test('draws on the sunken surface rather than on black', async ({ page }) => {
  const worldId = await enterLibrary(page);
  await page.getByTestId('new-default-entity').click();
  await expect(page).toHaveURL(/\/entities\/[\w-]+$/);

  await page.goto(`/w/${worldId}/graph`);
  // The World's one Entity links to nothing, so the filter is what puts a drawing on screen at all —
  // and one node is the least of the background any drawing can cover.
  await page.getByTestId('graph-filters').click();
  await page.getByTestId('graph-orphans-toggle').click();

  // The layout's own hook for a painted frame, so the reading is of what cosmos.gl drew rather than of
  // whatever the canvas held before its first pass. Not the *settle* mark: settling costs a fixed count
  // of frames rather than a span of time (see `firstFrameMark`), which a runner rendering in software
  // does not pay inside any timeout, and the background is the clear colour of every frame anyway.
  const drawing = page.getByTestId('graph-canvas');
  await expect(drawing).toHaveAttribute('data-drawn', 'true', { timeout: 20_000 });

  const sunken = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--color-surface-sunken').trim(),
  );
  // Expected from the live token through the rasterise the contrast report uses, so the assertion holds
  // in whichever ColorScheme the suite is painted in.
  const [expected] = await page.evaluate(rasteriseColors, { values: [sunken] });
  const painted = await paintedBackground(drawing.locator('canvas'));

  // One 8-bit step of slack, for the trip through the GPU's unorm conversion and the screenshot's encode.
  const drifted = painted.filter((channel, i) => Math.abs(channel - expected[i]) > 1);
  expect(drifted, `the graph reads ${painted} where ${sunken} rasterises to ${expected}`).toEqual([]);
});
