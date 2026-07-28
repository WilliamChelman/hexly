import { PALETTE_PRESETS, PALETTE_PRESET_IDS } from '@hexly/domain';
import { expect, test } from './fixtures';

/**
 * The styleguide's Preset gallery (#386) — the one surface that shows the Palettes on offer to
 * someone who is not editing a World, so that a reader can judge them before committing to creating
 * one (ADR-0077).
 *
 * The empty storageState is the point of the spec: no session, and no World has ever been entered.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test('an anonymous visitor sees every Palette Preset, each in its own colours', async ({ page }) => {
  await page.goto('/styleguide');

  /**
   * What the engine reads back for a value the table authored — a Preset's Anchors are authored
   * notations and `toHaveCSS` answers in the engine's own, so both sides go through the same parse.
   */
  const rendered = (value: string) =>
    page.evaluate((raw) => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = raw;
      document.body.append(probe);
      const read = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return read;
    }, value);

  // Read off the table rather than a list here: a Preset added there has to appear with no edit to
  // the styleguide, which is what this loop asserts.
  for (const id of PALETTE_PRESET_IDS) {
    const card = page.getByTestId(`styleguide-preset-${id}`);
    await expect(card).toBeVisible();

    // In its own page and its own ink — not in whichever Palette the reader happens to be wearing.
    await expect(card).toHaveCSS('background-color', await rendered(PALETTE_PRESETS[id].values.page));
    await expect(card).toHaveCSS('color', await rendered(PALETTE_PRESETS[id].values.ink));

    // A Preset reaching the table with no copy beside it would render its own key paths as prose.
    await expect(card).not.toContainText('worldTheme.palettePreset');
  }
});
