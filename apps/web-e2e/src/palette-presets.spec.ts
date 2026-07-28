import type { Page } from '@playwright/test';
import { PALETTE_PRESETS, PALETTE_PRESET_IDS, PALETTE_TOKENS, PalettePreset } from '@hexly/domain';
import {
  CONTRAST_REPORT_TOKENS,
  ThemeWarning,
  contrastRasterisations,
  contrastVerdict,
  designToken,
  measureScheme,
  rasteriseColors,
} from '@hexly/web-styles';
import { expect, test } from './fixtures';

/**
 * The gate on what Hexly ships (ADR-0077, #382): every Palette Preset passes Hexly's own contrast
 * report — the body pairs, the mid-tone accent, the chip fills, and the Tone-versus-status collisions
 * ADR-0076 warned "was computed against Hexly's accent and does not automatically hold for theirs".
 *
 * Its own file, deliberately, rather than a case in `design-tokens.spec.ts`. That snapshot is *meant*
 * to be regenerated when a formula legitimately moves; this must never be. Kept together, a real
 * contrast failure would be silenced by a reflexive `UPDATE_TOKEN_TABLE=1`.
 *
 * It reads {@link PALETTE_PRESETS} rather than a list beside it, so a seventh Preset is a table entry
 * plus a passing report and cannot be added without one.
 */

/**
 * What the applier writes for one Preset: its eleven tier-1 values, then the tier-2 literals the Preset
 * states outright — an override last, because it is an opt-out from the role the anchors would have
 * derived, which is the order `resolveWorldTheme` applies them in.
 *
 * Built here rather than through that resolver: it lives in `@hexly/web-core`, whose barrel would pull
 * Angular into the Playwright process (`fixtures.ts`).
 */
function declarationsOf(preset: PalettePreset): Record<string, string> {
  const anchors = Object.entries(PALETTE_TOKENS).map(([field, token]) => [
    token,
    String(preset.values[field as keyof PalettePreset['values']]),
  ]);
  return { ...Object.fromEntries(anchors), ...preset.overrides };
}

/**
 * One Palette's report, taken the way the editor's own contrast panel takes a draft's: the engine
 * answers what only an engine can — `measureScheme`, then `rasteriseColors` — and `contrastVerdict`
 * judges. Those are `contrastReport`'s own halves, split because the whole of it cannot cross
 * `page.evaluate`; a gate composing its own measurement could read clear where the panel warned.
 */
async function reportFor(page: Page, preset: PalettePreset): Promise<readonly ThemeWarning[]> {
  const resolved = await page.evaluate(measureScheme, {
    scheme: preset.scheme,
    declarations: declarationsOf(preset),
    tokens: CONTRAST_REPORT_TOKENS,
  });
  const rasterisations = contrastRasterisations(resolved);
  // `null` is a report that could not be taken, and must never read as a clean bill of health.
  if (!rasterisations) throw new Error(`the ${preset.id} Palette left a token the report reads unresolved`);

  const rasterised = [];
  for (const request of rasterisations) rasterised.push(await page.evaluate(rasteriseColors, request));
  return contrastVerdict(rasterised);
}

/**
 * A warning as a line naming what it is about and what it measured, so a failure reads as the pair that
 * broke rather than as a diff of union objects.
 */
function lineFor(warning: ThemeWarning): string {
  switch (warning.kind) {
    case 'contrast':
      return `${warning.ink} on ${warning.ground} reads ${warning.ratio.toFixed(2)}:1`;
    case 'chipContrast':
      return `${warning.ink} on its own fill over ${warning.ground} reads ${warning.ratio.toFixed(2)}:1`;
    case 'midToneAccent':
      return `no automatic foreground clears --color-accent — the best is ${warning.ratio.toFixed(2)}:1`;
    case 'toneCollision':
      return `${warning.tone} is ΔE00 ${warning.distance.toFixed(2)} from ${warning.against}`;
  }
}

/**
 * The styleguide, because the gate wants the design system and no World: it declares every tier at
 * `:root` as any route does, and it is reached without entering a World, so no applier has written a
 * Theme inline on the root that a measurement would then have to clear.
 */
async function openStyleguide(page: Page): Promise<void> {
  await page.goto('/styleguide');
  await expect(page.locator('html')).toHaveAttribute('data-color-scheme', /^(light|dark)$/);
}

for (const preset of PALETTE_PRESET_IDS.map((id) => PALETTE_PRESETS[id])) {
  test(`the ${preset.id} Palette Preset passes Hexly's own contrast report`, async ({ page }) => {
    await openStyleguide(page);

    const report = await reportFor(page, preset);

    expect(report.map(lineFor), `the ${preset.scheme} Palette Preset ${preset.id}`).toEqual([]);
  });
}

/**
 * The control. A gate that silently measured nothing — a probe reading the reader's own scheme, a
 * rasterisation batch handed back empty — would report every Preset clear and go on passing forever.
 *
 * Each case moves one anchor of a shipped Palette and names the check it is meant to trip, so every
 * kind of warning is shown to fire through *this* path and not only through `contrast.spec.ts`'s
 * fabricated colours.
 */
const BROKEN: readonly {
  readonly what: string;
  readonly values: Partial<PalettePreset['values']>;
  readonly line: RegExp;
}[] = [
  // Sepia ink lifted to within a shade of its own paper.
  { what: 'body pairs', values: { ink: '#eadfc0' }, line: /^--color-ink on --color-bg reads \d/ },
  // The canonical AA boundary grey, which is also where `contrast-color()` changes its mind: it answers
  // black or white and nothing between, so an accent either side of that switch is one no automatic
  // foreground rescues (ADR-0076).
  { what: 'mid-tone accent', values: { accent: '#767676' }, line: /^no automatic foreground clears/ },
  // Danger moved onto the first Tone itself. Off the manifest's initial rather than a hex written here:
  // `design-tokens.spec.ts` holds every initial to what its token resolves to in light, so this stays
  // the colour Solar's tone-1 actually is however the rotation is refitted.
  {
    what: 'tone separation',
    values: { danger: designToken('--color-tone-1').initial },
    line: /^--color-tone-\d is ΔE00 \d/,
  },
  // The accent lifted until the Tones scaled off it no longer clear their own 14% wash. The one kind
  // the three above cannot reach: a chip's text is read against a fill, not against a ground.
  {
    what: 'chip fills',
    values: { accent: '#bf8e44' },
    line: /^--color-tone-\d on its own fill over/,
  },
];

for (const broken of BROKEN) {
  test(`the gate bites: a Solar Palette that breaks its ${broken.what} is reported`, async ({ page }) => {
    await openStyleguide(page);
    const preset: PalettePreset = {
      ...PALETTE_PRESETS.solar,
      values: { ...PALETTE_PRESETS.solar.values, ...broken.values },
    };

    const report = await reportFor(page, preset);

    // The line, not the count: a control that only counted would pass while the gate reported some
    // other pair entirely.
    expect(report.map(lineFor), `a Solar Palette with its ${broken.what} broken`).toContainEqual(
      expect.stringMatching(broken.line),
    );
  });
}
