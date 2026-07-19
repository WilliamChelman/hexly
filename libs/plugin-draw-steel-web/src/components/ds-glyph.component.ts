import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, input } from '@angular/core';

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
export const DS_GLYPHS = {
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

/** A semantic glyph name the Draw Steel Glyphs font can render; the input is narrowed to this so `strictTemplates` rejects the rest. */
export type DsGlyphName = keyof typeof DS_GLYPHS;

/**
 * A glyph from the bundled **Draw Steel Glyphs** font — the plugin's counterpart to web-ui's
 * `IconComponent`, for symbols that font ships rather than Lucide (ADR-0007). Callers pass a semantic
 * name (`<ds-glyph glyph="area" />`); {@link DS_GLYPHS} resolves it to the character the font maps.
 *
 * This is how a bundled plugin "declares a font" cleanly under Approach A: the `@font-face` lives
 * next to the code that uses it, and its `src: url()` resolves at build time to the bundled `.otf`
 * (served as a hashed asset) — no edit to the app's global stylesheet or asset list. Because the
 * font is only referenced from here, it is fetched lazily, the first time a glyph renders.
 *
 * `ViewEncapsulation.None`: an `@font-face` cannot be scoped, and the `.ds-glyph` family rule is
 * meant to be shared by every glyph the plugin draws — Tailwind's `@source` list omits the plugin
 * libs, so an arbitrary `font-[...]` utility would never be generated (that is why the family is
 * named in scoped CSS, not a utility class). The rules live in an external `styleUrl` file, not
 * inline `styles`, because the builder can only resolve a relative `url()` against a real file.
 */
@Component({
  selector: 'ds-glyph',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: './ds-glyph.component.css',
  // Decorative by default (a glyph carries no text meaning); pass `label` when it must be announced.
  template: `<span class="ds-glyph" [attr.aria-hidden]="label() ? null : true" [attr.aria-label]="label()">{{
    char()
  }}</span>`,
})
export class DsGlyphComponent {
  /** The symbol to render, named by meaning; resolved to a character through {@link DS_GLYPHS}. */
  readonly glyph = input.required<DsGlyphName>();
  /** Optional accessible name; when set the glyph is announced instead of hidden. */
  readonly label = input<string | null>(null);
  protected readonly char = computed(() => DS_GLYPHS[this.glyph()]);
}
