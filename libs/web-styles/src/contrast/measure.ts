/**
 * Reading tokens as a ColorScheme other than the reader's own would resolve them (ADR-0076) — what a
 * contrast report for the half of a Theme nobody is looking at is made of.
 *
 * **Measured on the document root, never on an offscreen probe.** ADR-0076 widened the tier-1
 * declarations to `[data-color-scheme]` on any element so a probe could carry the opposite scheme, and
 * that much works — but only for tier 1. The tier-2 roles are declared once at `:root` by `@theme
 * static`, and a registered custom property computes *where it is declared*, so a probe re-declares
 * `--palette-*` and then inherits the root's already-derived `--color-*`: half a measurement, in
 * silence. `world-theme.spec.ts` pins that. The root is the one element the whole cascade reaches.
 *
 * Swapping the root and putting it back inside a single task is flash-free rather than merely fast: a
 * paint happens between tasks, never inside one, and `getComputedStyle` forces the style recalculation
 * synchronously — so the values come back resolved and the reader never sees the scheme they are not in.
 *
 * {@link measureScheme} and {@link rasteriseColors} are self-contained by rule, referencing nothing but
 * their arguments and the DOM, so `apps/web-e2e` can hand them straight to `page.evaluate` and test the
 * mechanism itself rather than a copy of it.
 */

import { CONTRAST_TOKENS, MeasuredScheme, ThemeWarning, themeWarnings } from './contrast';

/** What a measurement asks for: which ColorScheme, which candidate declarations, which tokens. */
export interface SchemeMeasurement {
  /** The value of `data-color-scheme` to measure under — the scheme the reader may not be in. */
  readonly scheme: string;
  /** Custom properties to apply first, inline on the root: an editor's unsaved Palette, typically. */
  readonly declarations: Readonly<Partial<Record<string, string>>>;
  readonly tokens: readonly string[];
}

/**
 * Every token in `tokens`, resolved as `scheme` and `declarations` would render it. The root is left
 * exactly as it was found, including on the throwing path.
 */
export function measureScheme(measurement: SchemeMeasurement): Record<string, string> {
  const root = document.documentElement;
  const style = root.getAttribute('style');
  const scheme = root.getAttribute('data-color-scheme');
  try {
    root.setAttribute('data-color-scheme', measurement.scheme);
    // A layer may be silent on a token (an operator branding one anchor, say), and silence means "let
    // the stylesheet answer" rather than "declare nothing".
    for (const [name, value] of Object.entries(measurement.declarations)) {
      if (value !== undefined) root.style.setProperty(name, value);
    }
    const computed = getComputedStyle(root);
    // Read before restoring, and read every token: the object is live, so a value taken after the
    // attributes go back would be the reader's own scheme wearing this one's name.
    return Object.fromEntries(measurement.tokens.map((token) => [token, computed.getPropertyValue(token).trim()]));
  } finally {
    if (style === null) root.removeAttribute('style');
    else root.setAttribute('style', style);
    if (scheme === null) root.removeAttribute('data-color-scheme');
    else root.setAttribute('data-color-scheme', scheme);
  }
}

/**
 * Each CSS colour as a 2D drawing context rasterises it — 8-bit sRGB, whatever syntax it was written
 * in, and gamut-mapped exactly as the display will get it. That is what makes a ratio computed over
 * these the ratio a reader experiences, and it is the one parse an `oklch()`, a `color(srgb …)` and a
 * hex can share. Alpha is dropped: the anchors a Palette carries are opaque.
 */
export function rasteriseColors(values: readonly string[]): [number, number, number][] {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('no 2d context');
  return values.map((value) => {
    context.clearRect(0, 0, 1, 1);
    // Seeded, so a value the context refuses to parse leaves black rather than the previous colour.
    context.fillStyle = '#000000';
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
    return [red, green, blue];
  });
}

/**
 * Whether one candidate Palette is readable in one ColorScheme: measure, rasterise, judge. The whole
 * face of the report — a caller names a scheme and the anchors it is considering, and gets back what an
 * Owner should look at before shipping.
 *
 * Unlike the two above this is not `page.evaluate`-safe, and does not need to be: what a browser has to
 * answer is the measurement, and the judging is unit-covered in `contrast.spec.ts`.
 */
export function contrastReport(
  scheme: string,
  declarations: Readonly<Partial<Record<string, string>>>,
): readonly ThemeWarning[] {
  const resolved = measureScheme({ scheme, declarations, tokens: CONTRAST_TOKENS });
  // Readability can only be checked in a browser (ADR-0076): the derivation is CSS-side, so under an
  // engine that does not resolve registered custom properties there is nothing measured to judge, and
  // an empty report is the honest answer rather than one over a document full of unresolved black.
  if (CONTRAST_TOKENS.some((token) => !resolved[token])) return [];

  const rasterised = rasteriseColors(CONTRAST_TOKENS.map((token) => resolved[token]));
  const measured: MeasuredScheme = Object.fromEntries(CONTRAST_TOKENS.map((token, i) => [token, rasterised[i]]));
  return themeWarnings(measured);
}
