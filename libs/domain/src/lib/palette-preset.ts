/**
 * The Palette Presets (ADR-0077): whole Palettes Hexly ships ready to pick, one per ColorScheme, that
 * an Owner copies into their World Theme as a starting point.
 *
 * Hexly's own two go through this table rather than sitting beside it, which is ADR-0075's argument
 * reapplied — "a derivation exercised only by other people's themes is a code path nobody on this
 * project ever looks at". `tokens.css`'s tier-1 regions are generated from the entries below
 * (`palette-block.ts`), so the stylesheet cannot say one thing and the table another.
 *
 * Values are authored notations, not canonical ones: applying a Preset writes into a draft Theme and
 * goes through the same write choke point an Owner's own value does (ADR-0076).
 */

import type { PublicDesignToken } from '@hexly/web-styles';
import type { WorldTheme, WorldThemePalette } from './world-theme';

/**
 * The key a stored World Theme names one of its two Palettes by — the ColorScheme itself since
 * ADR-0077, where it used to be the Preset Hexly happens to wear at that end. Fenced against the
 * `overrides` block's own keys, so a Preset cannot name a ColorScheme only one of the two levels has.
 *
 * Spelled here rather than taken from `ColorScheme`, which lives in `@hexly/web-core`: this library
 * sits under that one, and the server reads this table.
 */
export const WORLD_THEME_SCHEME_KEYS = ['light', 'dark'] as const satisfies readonly (keyof NonNullable<
  WorldTheme['overrides']
>)[];

export type WorldThemeSchemeKey = (typeof WORLD_THEME_SCHEME_KEYS)[number];

/**
 * The Presets on offer. A compatibility surface in `hexly.yml` alone (ADR-0077): no id ever enters
 * stored data, so renaming one is a breaking change for an operator's config and a non-event for every
 * stored World Theme.
 */
export const PALETTE_PRESET_IDS = ['solar', 'astral'] as const;

export type PalettePresetId = (typeof PALETTE_PRESET_IDS)[number];

/**
 * One ready-made Palette. Per-ColorScheme rather than a light/dark pair, because that is the
 * granularity the stored Theme, the editor and the overrides map already work at (ADR-0077).
 */
export interface PalettePreset {
  readonly id: PalettePresetId;
  readonly scheme: WorldThemeSchemeKey;
  /** The eleven tier-1 values — eight anchors and three knobs. */
  readonly values: WorldThemePalette;
  /**
   * The tier-2 roles this Preset states outright. Load-bearing, not decoration: the stylesheet keys off
   * `[data-color-scheme]` and a stored Theme carries no Preset id, so `overrides` is the only mechanism
   * that can carry a per-Preset named literal at all (ADR-0077).
   */
  readonly overrides?: Readonly<Partial<Record<PublicDesignToken, string>>>;
}

/** Every Preset, by id. The identity the first two carry is `docs/design/identity.md`'s (ADR-0006). */
export const PALETTE_PRESETS: Readonly<Record<PalettePresetId, PalettePreset>> = {
  solar: {
    id: 'solar',
    scheme: 'light',
    values: {
      page: '#f1e5c7', // the table / outer ivory paper
      ink: '#2e2412', // primary sepia-ink text
      inkQuiet: '#6f5a36', // secondary ink — carries its own hue
      // Darkened, and only in L, because ADR-0076's report warned on Hexly's own untouched Palette —
      // world-theme-spec.md §1.
      accent: '#8c5e00', // heliograph gold — the through-line accent
      danger: '#a21b01', // burnt-sienna marginalia
      success: '#325e01', // moss
      canvas: '#efe2bf', // the map field
      // Shadow / scrim ink — warm sepia, and lighter than `ink`, which is why it is its own anchor.
      soot: '#3c2c16',
      polarity: 1, // +1 light / −1 dark: every ramp direction
      lineAlpha: 0.371, // opacity of the drawn-rule ramp
      veil: 0.12, // base opacity of shadows, scrims, the vignette
    },
  },
  astral: {
    id: 'astral',
    scheme: 'dark',
    values: {
      page: '#0b0c1a', // the night table
      ink: '#ece3cf', // starlit parchment text
      inkQuiet: '#9aa0c8', // cool lavender-grey
      accent: '#d9b25a', // constellation gold leaf
      danger: '#fe7a54', // warm coral marginalia
      success: '#71ca42', // aurora green
      canvas: '#12152e', // the map field at night
      soot: '#02020a', // near-black scrim ink
      polarity: -1,
      lineAlpha: 0.16,
      veil: 0.5,
    },
    // Indigo starlight over indigo paper is a different design idea from Solar's warm highlight of its
    // own paper, and no one expression fits both (ADR-0075's named-literal exception).
    overrides: { '--color-canvas-glow': 'rgba(58, 70, 140, 0.26)' },
  },
};

/**
 * The Preset each ColorScheme is painted in when no World Theme applies — Hexly's own pair, and what
 * `tokens.css`'s generated regions restate.
 */
export const DEFAULT_PALETTE_PRESETS = {
  light: 'solar',
  dark: 'astral',
} as const satisfies Readonly<Record<WorldThemeSchemeKey, PalettePresetId>>;

/**
 * What one ColorScheme offers, in table order. Beside the table rather than in each surface that lists
 * it, so a Preset added above reaches the editor's swatch row and the styleguide's gallery at once.
 */
export function palettePresetsFor(scheme: WorldThemeSchemeKey): readonly PalettePreset[] {
  return PALETTE_PRESET_IDS.map((id) => PALETTE_PRESETS[id]).filter((preset) => preset.scheme === scheme);
}
