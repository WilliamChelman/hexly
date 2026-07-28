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
export const PALETTE_PRESET_IDS = ['solar', 'vellum', 'herbarium', 'astral', 'obsidian', 'ember'] as const;

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

/**
 * Every Preset, by id — three per ColorScheme, one neutral and one flavoured beside Hexly's own. The
 * identity Solar and Astral carry is `docs/design/identity.md`'s (ADR-0006); the other four answer the
 * two things an Owner arrives wanting, out of the sepia personality or into a different one.
 *
 * **The accents are fitted, not picked.** The eight `--color-tone-*` are hue rotations off
 * `--color-accent` (ADR-0075), so a Preset rotates the whole categorical set and ADR-0076's warning
 * that the danger/success separation "was computed against Hexly's accent and does not automatically
 * hold for theirs" is about these entries first. Every anchor below was measured against the contrast
 * report and moved until it was silent; `palette-presets.spec.ts` is what holds them there.
 */
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
  vellum: {
    id: 'vellum',
    scheme: 'light',
    values: {
      page: '#eaedf1', // cool neutral paper
      ink: '#252c35', // slate ink
      inkQuiet: '#576372', // slate, one step back
      // Slate blue, and quiet in chroma: the eight Tones take this chroma unchanged, and it is what
      // holds them off danger and success, which the rotation leaves Tones 17° and 11° from. At
      // Solar's chroma the nearer pair reads ΔE00 8.2.
      accent: '#3a6089',
      danger: '#a01011', // deep red
      success: '#20631a', // deep green, 11° warm of the Tone the rotation puts at 152°
      canvas: '#e6eaef', // the map field
      soot: '#272e39', // cool scrim ink
      polarity: 1,
      lineAlpha: 0.371,
      veil: 0.12,
    },
  },
  herbarium: {
    id: 'herbarium',
    scheme: 'light',
    values: {
      page: '#e5ecdf', // pale sage paper
      ink: '#172f1d', // deep forest ink
      inkQuiet: '#4f664f', // sage, one step back
      // Brass, darkened in L as Solar's own accent was and for the same pair: on paper this pale it
      // clears AA at 4.78, and at oklch L 0.545 it does not clear at all.
      accent: '#806118',
      danger: '#a3170b', // sealing-wax red
      success: '#255f16', // pressed leaf, 25° warm of the Tone the brass rotation puts at 165°
      canvas: '#e1e9da', // the map field
      soot: '#243221', // green-black scrim ink
      polarity: 1,
      lineAlpha: 0.371,
      veil: 0.12,
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
  obsidian: {
    id: 'obsidian',
    scheme: 'dark',
    values: {
      page: '#0d0e10', // neutral near-black
      ink: '#e1e5ea', // cool ink
      inkQuiet: '#96a0a9', // cool grey, one step back
      // Cyan, and kept light: the Tones are scaled off this lightness, which is what separates them
      // both from a chip's own 14% wash and from a danger the rotation leaves a Tone 5° off. At oklch
      // L 0.72 both checks fail.
      accent: '#6eccd1',
      danger: '#fd736f', // signal red
      success: '#5ecc7e', // signal green
      canvas: '#15171a', // the map field at night
      soot: '#020203', // near-black scrim ink
      polarity: -1,
      lineAlpha: 0.16,
      veil: 0.5,
    },
    // Astral's indigo starlight over a neutral near-black would be a colour this Palette has nowhere
    // else, so the field states its own (ADR-0077).
    overrides: { '--color-canvas-glow': 'rgba(36, 85, 95, 0.26)' },
  },
  ember: {
    id: 'ember',
    scheme: 'dark',
    values: {
      page: '#110c08', // warm charcoal
      ink: '#e1ddd8', // ash ink
      inkQuiet: '#a09890', // ash, one step back
      // Forge-orange, lifted in L: a chip's own text sits on a 14% wash of itself and the Tones are
      // scaled off this lightness — at oklch L 0.72 the categorical set stops clearing AA there.
      accent: '#f4a25c',
      // Pulled 17° below the Tone that sits just under the accent; at a conventional red the two read
      // ΔE00 5.9.
      danger: '#fc7180',
      success: '#64d686', // signal green
      canvas: '#1a140f', // the map field at night
      soot: '#040201', // near-black scrim ink
      polarity: -1,
      lineAlpha: 0.16,
      veil: 0.5,
    },
    // A warm-charcoal World glowing indigo is exactly what the override slot exists to stop (ADR-0077).
    overrides: { '--color-canvas-glow': 'rgba(114, 62, 20, 0.26)' },
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
