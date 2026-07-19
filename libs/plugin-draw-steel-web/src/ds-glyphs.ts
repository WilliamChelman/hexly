/// <reference path="./font-assets.d.ts" />
import { fontGlyph, IconFont, IconGlyph } from '@hexly/web-ui';
// Bundled next to the code that loads it (ADR-0007): the esbuild `file` loader emits the `.otf` as a
// hashed asset and the import resolves to its runtime URL — no edit to the app's global asset list.
import fontUrl from './assets/fonts/DrawSteelGlyphs-Regular.otf' with { loader: 'file' };

/** The family the bundled **Draw Steel Glyphs** font declares; {@link DS_FONT} loads it under this name. */
const DS_FONT_FAMILY = 'Draw Steel Glyphs';

/**
 * Semantic name → the character `DrawSteelGlyphs-Regular.otf` maps to that symbol (font version 002.101).
 * Callers name the *meaning* (`area`, `burst`), never the opaque source character — the font's glyph names
 * are just the input letters, so this map is the only place the two are tied together. Derived from the
 * font's published glyph sheet; regenerate if the `.otf` is replaced.
 *
 * The font ships no GSUB/ligature table, so every value is a single character. A handful of alternate-notation
 * tier glyphs (the fraction/accent variants of `!` `@` `#`), the raw minus, and the quote are intentionally
 * left unnamed — add a key here if a design ever needs one.
 */
const DS_GLYPHS = {
  // Ability distance, target, and keyword symbols
  area: 'e',
  areaOfEffect: 'o',
  burst: 'b',
  melee: 't',
  ranged: 'g',
  self: 'f',
  special: 'c',
  versatile: 'l',
  targets: 'x',
  trait: '*',

  // Action types
  malice: 'd', // Villain Action ("Malice")
  activation: '(',
  triggeredAction: ')',

  // Power-roll tiers and outcome bands
  tier1: '!',
  tier2: '@',
  tier3: '#',
  weak: 'w',
  average: 'v',
  strong: 's',

  // Musical notes (flavour)
  note: 'n',
  noteBeamed: 'N',

  // Characteristics — rounded badge
  might: 'M',
  agility: 'A',
  reason: 'R',
  intuition: 'I',
  presence: 'P',
  // Characteristics — square/block badge
  mightBlock: 'm',
  agilityBlock: 'a',
  reasonBlock: 'r',
  intuitionBlock: 'i',
  presenceBlock: 'p',

  // Block-style digits
  num0: '0',
  num1: '1',
  num2: '2',
  num3: '3',
  num4: '4',
  num5: '5',
  num6: '6',
  num7: '7',
  num8: '8',
  num9: '9',

  // Block-style operators/separators, for composing number displays (e.g. a tier's `≤11`)
  bracketLeft: '[',
  bracketRight: ']',
  dash: '-',
  less: '<',
  equal: '=',
  greater: '>',
  lessEqual: '≤',
  greaterEqual: '≥',
  multiply: '×',
  divide: '÷',

  // Decorative diamond separators, small → large
  diamond1: '¡',
  diamond2: '¢',
  diamond3: '£',
  diamond4: '¥',
  diamond5: '®',
  diamond6: '©',
} as const;

/** A symbol the Draw Steel Glyphs font can render, named by meaning. */
export type DsGlyphName = keyof typeof DS_GLYPHS;

/**
 * The registry name each Draw Steel font glyph registers under — `ds-<meaning>`, the plugin's glyph
 * namespace (ADR-0007), the same `ds-*` convention its Lucide glyphs use. Pass it to `<app-icon name>`.
 */
export type DsIconName = `ds-${DsGlyphName}`;

/** The `<app-icon>` name for a Draw Steel glyph — `dsIcon('area')` → `'ds-area'`. */
export function dsIcon(glyph: DsGlyphName): DsIconName {
  return `ds-${glyph}`;
}

/** The Draw Steel Glyphs font, loaded via `provideIconFont` so the plugin's font glyphs can draw. */
export const DS_FONT: IconFont = { family: DS_FONT_FAMILY, source: fontUrl };

/**
 * The plugin's font glyphs, registered through `provideIcons` alongside its Lucide ones (ADR-0007):
 * every {@link DS_GLYPHS} entry as an `<app-icon name="ds-…">` the Draw Steel font draws.
 */
export const DS_FONT_GLYPHS: readonly IconGlyph[] = Object.entries(DS_GLYPHS).map(([name, char]) =>
  fontGlyph(`ds-${name}`, char, DS_FONT_FAMILY),
);
