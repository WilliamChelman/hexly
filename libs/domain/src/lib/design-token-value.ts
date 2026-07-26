/**
 * Typed design-token values — the World Theme write choke point (ADR-0076), where an Owner's value is
 * parsed and what stores is re-serialised from that parse. Nothing is sanitised into something that
 * stores: a `url()` is refused because it is not a colour, not stripped out of one.
 */

import { converter, parse as parseColor } from 'culori';
import { TokenType } from '@hexly/web-styles';

/**
 * The longest raw value offered to a parser. The longest value the manifest ships is a 44-character
 * shadow, so this leaves room for a multi-layer one while keeping a pathological string away from the
 * parsers entirely.
 */
const MAX_RAW_LENGTH = 240;

/** How many `box-shadow` layers a value may carry, and how many words one layer may hold. */
const MAX_SHADOW_LAYERS = 4;
const MAX_SHADOW_WORDS = 6;

/**
 * The `<length>` units accepted — short of CSS's full set, so the schema and the browser say the same
 * thing. No `%`, which a `syntax: '<length>'` registration discards (ADR-0075); and no font-relative
 * unit, because a registered property computes at the element that *declares* it and a Theme declares
 * at `:root`, so `2em` would silently mean twice the root's size rather than the author's.
 */
const LENGTH_UNITS = ['px', 'rem', 'vw', 'vh', 'vmin', 'vmax'] as const;

const NUMBER = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const LENGTH = new RegExp(`^([+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+))(${LENGTH_UNITS.join('|')})?$`);

/** Characters that only ever appear in an attempt to escape the value they sit in. */
const ESCAPE_CHARS = /[;{}"'\\@]/;

const toOklch = converter('oklch');

const round = (value: number, places: number): number => Number(value.toFixed(places));
const clamp = (value: number, low: number, high: number): number => Math.min(Math.max(value, low), high);

/**
 * culori reads past its own token list on a malformed function (`f(1x)`, `rgb(0 0 0 / 50s)`) and
 * throws. A refusal has to arrive as a refusal — a thrown `TypeError` escapes `safeParse` and reaches
 * the client as a 500, from any signed-in caller, before the choke point's Owner check.
 */
function parseNeverThrows(raw: string): ReturnType<typeof parseColor> {
  try {
    return parseColor(raw);
  } catch {
    return undefined;
  }
}

/**
 * A colour in one canonical notation, or `undefined` if the input is not a colour. OKLCH because it is
 * the space the derivation works in (ADR-0075) and it is lossless for every notation an author can
 * send. Components are clamped to the ranges CSS clamps them to, and a powerless hue serialises as `0`,
 * so the stored value is always three numbers.
 */
function canonicalColor(raw: string): string | undefined {
  const parsed = parseNeverThrows(raw.trim());
  if (!parsed) return undefined;
  const { l, c, h, alpha } = toOklch(parsed);
  if (!Number.isFinite(l) || !Number.isFinite(c)) return undefined;
  const lightness = round(clamp(l, 0, 1), 4);
  const chroma = round(Math.max(c, 0), 4);
  const hue = round(Number.isFinite(h) ? (((h as number) % 360) + 360) % 360 : 0, 2);
  const opacity = clamp(alpha ?? 1, 0, 1);
  return opacity === 1
    ? `oklch(${lightness} ${chroma} ${hue})`
    : `oklch(${lightness} ${chroma} ${hue} / ${round(opacity, 4)})`;
}

/** A `<number>`, re-emitted from the parsed value. */
function canonicalNumber(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!NUMBER.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? String(value) : undefined;
}

/**
 * A `<length>`, re-emitted as its number and unit. Only a zero may be unitless, as in CSS. Rounded and
 * bounded so the number never re-serialises in exponent notation, which the grammar above admits no
 * more than CSS does — canonicalising a canonical value has to return it unchanged.
 */
function canonicalLength(raw: string): string | undefined {
  const match = LENGTH.exec(raw.trim());
  if (!match) return undefined;
  const value = round(Number(match[1]), 4);
  const unit = match[2];
  if (!Number.isFinite(value) || Math.abs(value) >= 1e6) return undefined;
  if (!unit) return value === 0 ? '0' : undefined;
  return `${value}${unit}`;
}

/**
 * Split on delimiters that sit outside every parenthesis, so a function arrives whole — a `url(…)` is
 * refused as one word rather than passing as fragments that each look harmless. Unbalanced parentheses
 * end the parse; empty pieces are dropped, since neither a bare comma nor doubled whitespace names a
 * value.
 */
function splitTopLevel(value: string, isDelimiter: (char: string) => boolean): string[] | undefined {
  const pieces: string[] = [];
  let current = '';
  let depth = 0;
  for (const char of value) {
    if (char === '(') depth++;
    if (char === ')' && --depth < 0) return undefined;
    if (depth === 0 && isDelimiter(char)) {
      if (current) pieces.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (depth !== 0) return undefined;
  if (current) pieces.push(current);
  return pieces;
}

/**
 * A `box-shadow`, re-emitted word by word: each word is `inset`, a `<length>`, or a `<color>`, and
 * anything else refuses the whole value. Order is preserved rather than normalised — the grammar lets
 * the colour sit at either end, and moving it would be rewriting the author's value rather than
 * re-serialising it.
 */
function canonicalShadow(raw: string): string | undefined {
  if (ESCAPE_CHARS.test(raw)) return undefined;
  const parts = splitTopLevel(raw, (char) => char === ',');
  if (!parts || parts.length === 0 || parts.length > MAX_SHADOW_LAYERS) return undefined;
  const canonical: string[] = [];
  for (const part of parts) {
    const parsed = splitTopLevel(part, (char) => /\s/.test(char));
    if (!parsed || parsed.length > MAX_SHADOW_WORDS) return undefined;
    const layer: string[] = [];
    let lengths = 0;
    let colors = 0;
    let inset = false;
    for (const word of parsed) {
      if (word.toLowerCase() === 'inset' && !inset) {
        inset = true;
        layer.push('inset');
        continue;
      }
      const length = canonicalLength(word);
      if (length !== undefined && ++lengths <= 4) {
        layer.push(length);
        continue;
      }
      const color = length === undefined ? canonicalColor(word) : undefined;
      if (color !== undefined && ++colors <= 1) {
        layer.push(color);
        continue;
      }
      return undefined;
    }
    // A shadow is at least an x and a y offset; fewer means the value was never a shadow.
    if (lengths < 2) return undefined;
    canonical.push(layer.join(' '));
  }
  return canonical.join(', ');
}

/**
 * The canonicaliser each token type is written through, or `null` for a type no World Theme value may
 * be authored for: a curated pairing writes the font stacks (spec §5.4), and a gradient is composed
 * from its stops rather than set, which is what keeps a `url()` off the page. Same shape as
 * `property-block.ts`'s `SYNTAX` map, answering the other half of the question.
 *
 * The manifest's `public` flag gates first, so `time`, `easing` and `gradient` never reach here from
 * the schema; the table is total because {@link TokenType} is.
 */
const CANONICALISERS: Readonly<Record<TokenType, ((raw: string) => string | undefined) | null>> = {
  color: canonicalColor,
  number: canonicalNumber,
  length: canonicalLength,
  shadow: canonicalShadow,
  'font-pairing': null,
  gradient: null,
  time: null,
  easing: null,
};

/** Whether a World Theme may carry a value for a token of this type at all. */
export function isSettableTokenType(type: TokenType): boolean {
  return CANONICALISERS[type] !== null;
}

/**
 * The canonical form of `raw` for a token of `type`, or `undefined` if it is not a value of that type.
 * The single entry point the schema validates through.
 */
export function canonicalTokenValue(type: TokenType, raw: string): string | undefined {
  const canonicalise = CANONICALISERS[type];
  if (!canonicalise || raw.length > MAX_RAW_LENGTH) return undefined;
  return canonicalise(raw);
}
