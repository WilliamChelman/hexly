/**
 * The tier-1 regions of `tokens.css`, written from {@link PALETTE_PRESETS} (ADR-0077) — the same
 * committed-output route the `@property` block and the pre-paint allowlist already take, down to the
 * fence-splicing itself, so the stylesheet stays a plain `@import` and `palette-block.spec.ts` fails
 * the build when the two drift.
 *
 * A *region* rather than a whole block: the Solar block interleaves tier 1 with the motion, elevation,
 * layout-rail and sheen tokens `@theme` cannot hold, and none of those are a Preset's to write.
 */

import { FencedRegion, GENERATE_COMMAND, fencedRegionIn, withFencedRegion } from '@hexly/web-styles';
import {
  DEFAULT_PALETTE_PRESETS,
  PALETTE_PRESETS,
  WORLD_THEME_SCHEME_KEYS,
  WorldThemeSchemeKey,
} from './palette-preset';
import { PALETTE_TOKENS, PaletteField } from './world-theme';

/** The stylesheet the regions are spliced into, relative to the repo root. */
export const TOKENS_STYLESHEET_PATH = 'libs/web-styles/src/tokens.css';

/** One fence per ColorScheme, since a block declares only its own Palette. */
function regionOf(scheme: WorldThemeSchemeKey): FencedRegion {
  return {
    path: TOKENS_STYLESHEET_PATH,
    open: `/* GENERATED — the ${scheme} Palette, from PALETTE_PRESETS in libs/domain. Run \`${GENERATE_COMMAND}\`. */`,
    close: '/* END GENERATED */',
  };
}

/**
 * One ColorScheme's generated region: its default Preset's eleven tier-1 values, then the tier-2
 * literals that Preset states. Token order is the manifest's, through {@link PALETTE_TOKENS}, so a new
 * anchor lands in the stylesheet where the contract declares it.
 */
export function palettePresetRegion(scheme: WorldThemeSchemeKey, indent = '  '): string {
  const preset = PALETTE_PRESETS[DEFAULT_PALETTE_PRESETS[scheme]];
  const lines = [regionOf(scheme).open];
  for (const [field, token] of Object.entries(PALETTE_TOKENS) as [PaletteField, string][]) {
    lines.push(`${token}: ${preset.values[field]};`);
  }
  const overrides = Object.entries(preset.overrides ?? {});
  if (overrides.length > 0) {
    lines.push('', "/* The Preset's own named literals — what no one expression over the anchors fits (ADR-0075). */");
    for (const [name, value] of overrides) lines.push(`${name}: ${value};`);
  }
  lines.push(regionOf(scheme).close);
  return lines.map((line) => (line === '' ? '' : indent + line)).join('\n');
}

/** {@link TOKENS_STYLESHEET_PATH}'s contents with both regions re-spliced between their fences. */
export function withPalettePresetRegions(css: string): string {
  return WORLD_THEME_SCHEME_KEYS.reduce(
    (sheet, scheme) => withFencedRegion(regionOf(scheme), sheet, (indent) => palettePresetRegion(scheme, indent)),
    css,
  );
}

/** The region a scheme's fences enclose, read back rather than re-rendered — the drift spec's subject. */
export function palettePresetRegionIn(css: string, scheme: WorldThemeSchemeKey): string {
  return fencedRegionIn(regionOf(scheme), css);
}
