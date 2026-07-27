/**
 * Whether a Palette is readable (ADR-0076): the ratio and the verdict, over colours somebody else
 * measured. Warn, never block.
 *
 * Nothing here derives a colour. The tier-2 roles are one CSS expression each off the anchors
 * (ADR-0075) and are read back out of the engine that painted them, so the report matches what renders
 * by construction rather than by agreeing with it by luck.
 */

import { DESIGN_TOKENS, DesignToken } from '../tokens/manifest';

/** An sRGB colour as it rasterises — the 8-bit channels a reader's display actually receives. */
export type Rgb = readonly [number, number, number];

/** One ColorScheme's measured colours, keyed by the token each was read from. */
export type MeasuredScheme = Readonly<Partial<Record<DesignToken, Rgb>>>;

/** WCAG AA for body text. The floor ADR-0076 warns below, and never the floor it blocks below. */
export const BODY_CONTRAST_MIN = 4.5;

/**
 * The ΔE00 below which a category tone reads as a status colour — the design's own revealed tolerance,
 * not a literature number (`docs/design/spike-tone-rotation.md` §2). Hexly's eight clear it by 0.6 at
 * the tightest, thin because the exclusion arc was placed at this very threshold.
 */
export const TONE_CONFUSION_MAX = 20;

/**
 * The pairs a reader reads prose through: **the two inks against both grounds a panel and the page put
 * behind them, and the accent against the page** (ADR-0076). Not a cross product — the accent is not
 * body ink, and it is here because an Owner picks it, so it is checked where a link sits on the page.
 */
const BODY_PAIRS = [
  ['--color-ink', '--color-surface'],
  ['--color-ink', '--color-bg'],
  ['--color-ink-muted', '--color-surface'],
  ['--color-ink-muted', '--color-bg'],
  ['--color-accent', '--color-bg'],
] as const satisfies readonly (readonly [DesignToken, DesignToken])[];

/** The two colours a category tone must not be mistaken for; a chip must never read as an error. */
const STATUS_ROLES = ['--color-danger', '--color-success'] as const satisfies readonly DesignToken[];

/** The accent and the foreground CSS chose for it — the mid-tone check reads both (ADR-0076). */
const ON_FILL = ['--color-accent', '--color-on-fill'] as const satisfies readonly DesignToken[];

/** The categorical set, off the manifest — a ninth tone joins the check by being declared (ADR-0075). */
const TONES: readonly DesignToken[] = DESIGN_TOKENS.filter((decl) => /^--color-tone-\d+$/.test(decl.name)).map(
  (decl) => decl.name,
);

/** Each tone's soft fill, paired with its tone — what a chip puts its own text on. */
export const TONE_FILLS: readonly (readonly [DesignToken, DesignToken])[] = TONES.map((tone) => [
  tone,
  `${tone}-soft` as DesignToken,
]);

/**
 * The grounds a chip may sit on. Its fill is translucent (α 0.14, ADR-0075), so what its text is really
 * read against is that fill *composited* over whatever is behind — and the two differ by enough to
 * decide AA: Hexly's own tone-4 is 4.74:1 over `surface` and 4.18:1 over the page.
 */
export const CHIP_GROUNDS = ['--color-surface', '--color-bg'] as const satisfies readonly DesignToken[];

/** Every token a report reads, so a caller measures exactly what {@link themeWarnings} will ask for. */
export const CONTRAST_TOKENS: readonly DesignToken[] = [
  ...new Set<DesignToken>([...BODY_PAIRS.flat(), ...STATUS_ROLES, ...ON_FILL, ...TONES]),
];

/** Something an Owner should look at before shipping. Structured, so the copy stays in the catalogs. */
export type ThemeWarning =
  /** A body pair below {@link BODY_CONTRAST_MIN}; `ratio` is what it actually measured. */
  | { readonly kind: 'contrast'; readonly ink: DesignToken; readonly ground: DesignToken; readonly ratio: number }
  /** No automatic text colour is readable on this accent; `ratio` is the best either one reaches. */
  | { readonly kind: 'midToneAccent'; readonly ratio: number }
  /** A tone has rotated into confusion with a status colour; `distance` is the ΔE00 between them. */
  | {
      readonly kind: 'toneCollision';
      readonly tone: DesignToken;
      readonly against: DesignToken;
      readonly distance: number;
    }
  /** A chip's own text on its own fill, over the ground that reads worst of the two it may sit on. */
  | {
      readonly kind: 'chipContrast';
      readonly tone: DesignToken;
      readonly ground: DesignToken;
      readonly ratio: number;
    };

/**
 * Each tone's soft fill as it actually composites, per ground — `contrastReport` rasterises it over
 * each, because alpha is gone by the time a colour is an {@link Rgb} and the fill is 14% opaque.
 */
export type ChipFills = Readonly<Partial<Record<DesignToken, Readonly<Partial<Record<DesignToken, Rgb>>>>>>;

/**
 * What an Owner should look at in one ColorScheme's Palette, in reading order: the body pairs, then
 * the accent's own foreground, then the categorical set.
 */
export function themeWarnings(measured: MeasuredScheme, fills: ChipFills): readonly ThemeWarning[] {
  const color = (token: DesignToken): Rgb => {
    const value = measured[token];
    // A token nobody measured would otherwise pass as "no warning", which is the one wrong answer a
    // readability report can give.
    if (!value) throw new Error(`contrast report: ${token} was not measured`);
    return value;
  };

  return [...bodyWarnings(color), ...midToneWarning(color), ...toneWarnings(color), ...chipWarnings(color, fills)];
}

/**
 * A chip carries its category in its *text*, on its own tone at 14% (ADR-0075) — so the pair that has
 * to clear AA is the tone against that fill composited over the ground, not against the ground itself.
 * Only the worse ground is reported: a chip is one component, and the Owner fixes it once.
 */
function* chipWarnings(color: (token: DesignToken) => Rgb, fills: ChipFills): Generator<ThemeWarning> {
  for (const [tone] of TONE_FILLS) {
    const overGround = CHIP_GROUNDS.map((ground) => {
      const fill = fills[tone]?.[ground];
      if (!fill) throw new Error(`contrast report: ${tone} was not composited over ${ground}`);
      return { ground, ratio: contrastRatio(color(tone), fill) };
    });
    const worst = overGround.reduce((one, two) => (two.ratio < one.ratio ? two : one));
    if (worst.ratio < BODY_CONTRAST_MIN) yield { kind: 'chipContrast', tone, ...worst };
  }
}

function* bodyWarnings(color: (token: DesignToken) => Rgb): Generator<ThemeWarning> {
  for (const [ink, ground] of BODY_PAIRS) {
    const ratio = contrastRatio(color(ink), color(ground));
    if (ratio < BODY_CONTRAST_MIN) yield { kind: 'contrast', ink, ground, ratio };
  }
}

/**
 * `contrast-color()` answers black or white and nothing between, so a mid-lightness accent is one no
 * automatic foreground rescues (ADR-0076).
 *
 * Read off the resolved `--color-on-fill`, not recomputed: pure black or white always reaches 4.58:1,
 * so the naive condition can never fire, while the retinted on-colour that actually renders bottoms
 * out at 3.86:1.
 */
function* midToneWarning(color: (token: DesignToken) => Rgb): Generator<ThemeWarning> {
  const ratio = contrastRatio(color('--color-on-fill'), color('--color-accent'));
  if (ratio < BODY_CONTRAST_MIN) yield { kind: 'midToneAccent', ratio };
}

/**
 * The eight tones are hue rotations off the accent (ADR-0075), while danger and success are anchors an
 * Owner sets independently — so the exclusion arc computed against Hexly's accent does not hold for
 * theirs. Only the nearer status colour is reported: a chip reads as one thing, not two.
 */
function* toneWarnings(color: (token: DesignToken) => Rgb): Generator<ThemeWarning> {
  for (const tone of TONES) {
    const distances = STATUS_ROLES.map((against) => ({ against, distance: deltaE00(color(tone), color(against)) }));
    const nearest = distances.reduce((one, two) => (two.distance < one.distance ? two : one));
    if (nearest.distance < TONE_CONFUSION_MAX) yield { kind: 'toneCollision', tone, ...nearest };
  }
}

/** WCAG 2 relative contrast, 1:1 to 21:1. Symmetric — a pair has one ratio however it is ordered. */
export function contrastRatio(one: Rgb, two: Rgb): number {
  const [dark, light] = [luminance(one), luminance(two)].sort((a, b) => a - b);
  return (light + 0.05) / (dark + 0.05);
}

/** WCAG relative luminance: sRGB linearised, then weighted for the eye's response. */
function luminance([red, green, blue]: Rgb): number {
  const [r, g, b] = [red, green, blue].map(linearise);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function linearise(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/**
 * CIEDE2000 between two sRGB colours — the metric every number in the token spikes is quoted in, so a
 * threshold read off one of them means here what it meant there.
 */
export function deltaE00(one: Rgb, two: Rgb): number {
  const [l1, a1, b1] = lab(one);
  const [l2, a2, b2] = lab(two);

  const meanChroma = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const lift = 0.5 * (1 - Math.sqrt(meanChroma ** 7 / (meanChroma ** 7 + 25 ** 7)));
  const [ap1, ap2] = [a1 * (1 + lift), a2 * (1 + lift)];
  const [c1, c2] = [Math.hypot(ap1, b1), Math.hypot(ap2, b2)];
  const [h1, h2] = [hue(ap1, b1), hue(ap2, b2)];

  const dL = l2 - l1;
  const dC = c2 - c1;
  const dh = c1 * c2 === 0 ? 0 : wrap(h2 - h1);
  const dH = 2 * Math.sqrt(c1 * c2) * Math.sin((dh * Math.PI) / 360);

  const meanL = (l1 + l2) / 2;
  const meanC = (c1 + c2) / 2;
  const meanH =
    c1 * c2 === 0 ? h1 + h2 : Math.abs(h1 - h2) <= 180 ? (h1 + h2) / 2 : (h1 + h2 + (h1 + h2 < 360 ? 360 : -360)) / 2;

  const t = 1 - 0.17 * cos(meanH - 30) + 0.24 * cos(2 * meanH) + 0.32 * cos(3 * meanH + 6) - 0.2 * cos(4 * meanH - 63);
  const sL = 1 + (0.015 * (meanL - 50) ** 2) / Math.sqrt(20 + (meanL - 50) ** 2);
  const sC = 1 + 0.045 * meanC;
  const sH = 1 + 0.015 * meanC * t;
  // The blue region's hue-vs-chroma interaction, which is what separates CIEDE2000 from CIE76.
  const rotation =
    -Math.sin(2 * (30 * Math.exp(-(((meanH - 275) / 25) ** 2))) * (Math.PI / 180)) *
    2 *
    Math.sqrt(meanC ** 7 / (meanC ** 7 + 25 ** 7));

  return Math.sqrt((dL / sL) ** 2 + (dC / sC) ** 2 + (dH / sH) ** 2 + rotation * (dC / sC) * (dH / sH));
}

function cos(degrees: number): number {
  return Math.cos((degrees * Math.PI) / 180);
}

function hue(a: number, b: number): number {
  if (a === 0 && b === 0) return 0;
  const degrees = (Math.atan2(b, a) * 180) / Math.PI;
  return degrees < 0 ? degrees + 360 : degrees;
}

/** The shorter way round the hue circle, which is the one two colours are compared across. */
function wrap(degrees: number): number {
  if (degrees > 180) return degrees - 360;
  if (degrees < -180) return degrees + 360;
  return degrees;
}

/** CIE Lab under D65 — the white point sRGB itself is defined against, so no adaptation is needed. */
function lab(rgb: Rgb): readonly [number, number, number] {
  const [r, g, b] = rgb.map(linearise);
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const [fx, fy, fz] = [x, y, z].map((value) =>
    value > 216 / 24389 ? Math.cbrt(value) : (841 / 108) * value + 4 / 29,
  );
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
