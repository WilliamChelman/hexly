/**
 * The **Asset Stats** vocabulary (CONTEXT.md → Asset Stats, ADR-0065): the mechanical, write-time facts
 * an extractor derives from an Asset's bytes, and the pure derivations the `core.datatype.asset` harvest
 * turns them into facet dimensions. Framework-free and sharp-free — the sharp-backed extractor (server
 * only) *writes* this shape; this module only *reads* it, so the web and the domain share one vocabulary.
 *
 * The extractor lives out of process here on purpose: `bucketHue` is a pure function with a unit spec, so
 * the named-hue facet is provable without an image, and the harvest never depends on native code.
 */

import * as z from 'zod';

/** An image's shape, derived from its dimensions — the `orientation` facet the Browser toggles values on. */
export const ORIENTATIONS = ['landscape', 'portrait', 'square'] as const;

export type Orientation = (typeof ORIENTATIONS)[number];

/** The orientation `width`×`height` names: wider than tall is landscape, taller than wide is portrait. */
export function orientationOf(width: number, height: number): Orientation {
  if (width > height) return 'landscape';
  if (height > width) return 'portrait';
  return 'square';
}

/**
 * The image **Asset Stats** an `image/*` extractor writes into the asset-ref's `stats` (ADR-0065): the
 * pixel `width`/`height`, the derived `orientation`, and the `dominantColor` as a `#rrggbb` hex — the raw
 * value the harvest buckets into the named-hue facet, kept verbatim so a re-bucket never needs the bytes.
 */
export const imageStatsSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  orientation: z.enum(ORIENTATIONS),
  dominantColor: z.string().regex(/^#[0-9a-f]{6}$/, 'A dominant color is a lowercase #rrggbb hex'),
});

export type ImageStats = z.infer<typeof imageStatsSchema>;

/** The Asset `kind` facet, derived from mime (ADR-0065): image today, PDF/audio later, everything else `other`. */
export const ASSET_KINDS = ['image', 'pdf', 'audio', 'other'] as const;

export type AssetKind = (typeof ASSET_KINDS)[number];

/** The Asset kind a mime names — a mime prefix (`image/`, `audio/`) or the one exact `application/pdf`. */
export function assetKind(mime: string): AssetKind {
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('audio/')) return 'audio';
  return 'other';
}

/**
 * The named-hue facet buckets (ADR-0055/0065). The dominant color is stored as a value in stats; the facet
 * is the *bucket* — a small, translatable vocabulary the Browser rail can enumerate, rather than a
 * near-infinite hex space. Low-saturation colors fall to `black`/`white`/`gray`; the rest to a color wheel wedge.
 */
export const HUE_BUCKETS = [
  'red',
  'orange',
  'yellow',
  'green',
  'cyan',
  'blue',
  'purple',
  'pink',
  'black',
  'gray',
  'white',
] as const;

export type HueBucket = (typeof HUE_BUCKETS)[number];

/** A hex color's three channels as `0..255`, or `null` when `hex` is not a `#rrggbb` string. */
function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return null;
  return { r: parseInt(match[1], 16), g: parseInt(match[2], 16), b: parseInt(match[3], 16) };
}

/**
 * The named {@link HueBucket} a `#rrggbb` dominant color falls into (ADR-0065) — the facet the harvest
 * emits from the stored color. A pure, unit-tested function: a near-gray color (low saturation) buckets by
 * lightness into `black`/`gray`/`white`; a saturated one by its hue-wheel wedge. `null` for a string this
 * build cannot parse, so the harvest skips it rather than inventing a bucket.
 */
export function bucketHue(hex: string): HueBucket | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));

  // Too little chroma to read a hue: it is a shade of gray, split by lightness.
  if (saturation < 0.12) {
    if (lightness < 0.2) return 'black';
    if (lightness > 0.85) return 'white';
    return 'gray';
  }

  // Hue angle in degrees, then the wheel wedge it lands in. Red straddles 360°/0°.
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;

  if (hue < 15 || hue >= 345) return 'red';
  if (hue < 45) return 'orange';
  if (hue < 70) return 'yellow';
  if (hue < 165) return 'green';
  if (hue < 195) return 'cyan';
  if (hue < 255) return 'blue';
  if (hue < 285) return 'purple';
  return 'pink';
}
