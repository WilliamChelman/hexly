/**
 * Reading tokens as a ColorScheme other than the reader's own resolves them (ADR-0076).
 *
 * Measured on the document root, not on an offscreen probe: every tier is declared at `:root` alone
 * (ADR-0077), so a probe carrying the other ColorScheme inherits the reader's values entire.
 * `world-theme.spec.ts` pins it. Swapping the root and putting it back inside one task is flash-free —
 * a paint happens between tasks.
 *
 * {@link measureScheme} and {@link rasteriseColors} reference nothing but their arguments and the DOM,
 * so `apps/web-e2e` hands them to `page.evaluate` rather than testing a copy of them.
 */

import {
  CHIP_GROUNDS,
  CONTRAST_TOKENS,
  MeasuredScheme,
  Rgb,
  CHIP_FILLS,
  ThemeWarning,
  themeWarnings,
} from './contrast';

/** What a measurement asks for: which ColorScheme, which candidate declarations, which tokens. */
export interface SchemeMeasurement {
  /**
   * The `data-color-scheme` to measure under — the scheme the reader may not be in. Spelled as a
   * string rather than `ColorScheme`, which lives in `@hexly/web-core`: this is a leaf lib, and the
   * Playwright process that hands this function to `page.evaluate` must not pull Angular in.
   */
  readonly scheme: string;
  /** Custom properties to apply first, inline on the root: an editor's unsaved Palette, typically. */
  readonly declarations: Readonly<Partial<Record<string, string>>>;
  readonly tokens: readonly string[];
}

/**
 * Every token in `tokens`, resolved as `scheme` and `declarations` alone would render it — `declarations`
 * replaces whatever is inline rather than layering over it. The root is left exactly as it was found,
 * including on the throwing path.
 */
export function measureScheme(measurement: SchemeMeasurement): Record<string, string> {
  const root = document.documentElement;
  const style = root.getAttribute('style');
  const scheme = root.getAttribute('data-color-scheme');
  try {
    root.setAttribute('data-color-scheme', measurement.scheme);
    // Cleared first, and this is load-bearing: what is already inline is the *active* scheme's Theme,
    // written there by the applier, and it beats both schemes' stylesheet rules. Left in place, the
    // scheme nobody is looking at would be measured wearing the other one's overrides (ADR-0076).
    root.removeAttribute('style');
    // A layer may be silent on a token — an operator branding one anchor, say — and silence means "let
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
 * Each CSS colour as a 2D drawing context rasterises it: 8-bit sRGB, gamut-mapped exactly as a display
 * will get it, which is what makes a ratio over these the one a reader experiences. It is also the only
 * parse an `oklch()`, a `color(srgb …)` and a hex share.
 *
 * Alpha is answered rather than dropped: a contrast caller composites through `ground` and reads only
 * the first three channels, but the token snapshot holds a translucent `initial` to its alpha too, and
 * the serialisation boundary below forbids a second function to answer it.
 */
export function rasteriseColors(values: readonly string[], ground?: string): [number, number, number, number][] {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('no 2d context');
  return values.map((value) => {
    context.clearRect(0, 0, 1, 1);
    // Seeded, so a value the context refuses to parse leaves black rather than the previous colour.
    context.fillStyle = '#000000';
    // `ground` painted under first composites a translucent value the way the page does, rather than
    // handing back its own channels with the alpha thrown away — `page.evaluate` never passes it.
    if (ground !== undefined) {
      context.fillStyle = ground;
      context.fillRect(0, 0, 1, 1);
      context.fillStyle = '#000000';
    }
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data;
    return [red, green, blue, alpha];
  });
}

/**
 * Whether one candidate Palette is readable in one ColorScheme: measure, rasterise, judge — the whole
 * face of the report. `null` where the engine resolved nothing, which is a third answer and not a clean
 * bill of health: readability can only be checked in a browser (ADR-0076).
 *
 * `scheme` is a string because `ColorScheme` lives in `@hexly/web-core` and this is a leaf lib.
 */
export function contrastReport(
  scheme: string,
  declarations: Readonly<Partial<Record<string, string>>>,
): readonly ThemeWarning[] | null {
  // The soft fills are measured too, and only here: they are 14% opaque, so they have to be composited
  // before the alpha is gone (`chipWarnings`).
  const fillTokens = CHIP_FILLS.map(([, fill]) => fill);
  const wanted = [...CONTRAST_TOKENS, ...fillTokens];
  const resolved = measureScheme({ scheme, declarations, tokens: wanted });
  if (wanted.some((token) => !resolved[token])) return null;

  // Narrowed to the three channels a ratio is over: these are opaque, and the chip fills below have
  // already been composited through their ground.
  const rasterised = rasteriseColors(CONTRAST_TOKENS.map((token) => resolved[token])).map(
    ([red, green, blue]): Rgb => [red, green, blue],
  );
  const measured: MeasuredScheme = Object.fromEntries(CONTRAST_TOKENS.map((token, i) => [token, rasterised[i]]));

  const fills: Record<string, Record<string, Rgb>> = {};
  for (const ground of CHIP_GROUNDS) {
    const over = rasteriseColors(
      fillTokens.map((fill) => resolved[fill]),
      resolved[ground],
    ).map(([red, green, blue]): Rgb => [red, green, blue]);
    CHIP_FILLS.forEach(([tone], i) => ((fills[tone] ??= {})[ground] = over[i]));
  }
  return themeWarnings(measured, fills);
}
