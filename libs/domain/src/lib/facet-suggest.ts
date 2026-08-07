/**
 * What a search box may **offer** where the caret stands (ADR-0082): `$` reveals the whole filter
 * vocabulary, and after the key's colon the same list offers that Facet's values with their counts.
 *
 * Two stages, two sources, and the difference is load-bearing: **keys resolve synchronously** off the
 * client registry, while the Facet read feeds **values and counts only**, so a late response can make a
 * filter easier to type but never changes what one means. The grammar stays in `facet-token.ts`; this
 * reads a token only as far as the caret, which the parser — reading whole tokens — cannot answer.
 */

import { EntityFacets, FacetCount } from './entity';
import { facetCategoryOf, FacetKeySet, RESERVED_FACET_NAMES, startsFacetToken } from './facet-token';

/**
 * The token the caret stands in, as far as the caret: which half of the vocabulary is being typed, and
 * the slice `start`/`end` an accepted suggestion replaces — for a value opened with a quote, `start` is
 * the quote itself, so completing it replaces rather than nests. A `key` exists on the value stage
 * alone, which is why the two stages are separate shapes rather than one with an optional field.
 */
export type FacetSuggestContext = FacetKeyContext | FacetValueContext;

interface FacetSuggestSlice {
  /** What has been typed of the key or value so far; the list narrows on it. */
  readonly prefix: string;
  readonly start: number;
  readonly end: number;
}

export interface FacetKeyContext extends FacetSuggestSlice {
  readonly stage: 'key';
}

export interface FacetValueContext extends FacetSuggestSlice {
  readonly stage: 'value';
  /** The key already typed — what the caller looks its values up by. */
  readonly key: string;
}

/**
 * The suggestion context at `caret`, or `null` where the caret stands in plain text. Only the text
 * **before** the caret is read, so what follows it is left alone.
 */
export function facetSuggestAt(raw: string, caret: number): FacetSuggestContext | null {
  // Scanned forwards, token by token, exactly as the parser reads the same string — a `$` inside an
  // open quote (`$tag:"sea $to`) belongs to the value being typed, and starts nothing of its own.
  let i = 0;
  while (i < caret) {
    if (!startsFacetToken(raw, i)) {
      i++;
      continue;
    }
    const scanned = scanToken(raw, i, caret);
    if ('stage' in scanned) return scanned;
    i = scanned.end;
  }
  return null;
}

/** Where a token that closed before the caret gave out, so the scan resumes past it. */
interface TokenEnd {
  readonly end: number;
}

/** Read the token at `start` as far as `caret`: the context the caret stands in, or where it ended. */
function scanToken(raw: string, start: number, caret: number): FacetSuggestContext | TokenEnd {
  // Past the `-` that negates and the `$` that marks (ADR-0082: every token carries the `$`).
  const keyStart = start + (raw[start] === '-' ? 2 : 1);
  let i = keyStart;
  while (i < caret && raw[i] !== ':' && !isSpace(raw[i])) i++;
  if (i >= caret) return { stage: 'key', prefix: raw.slice(keyStart, caret), start: keyStart, end: caret };
  // A space before the colon ends the token: a `$` with no colon is a name, not yet a filter.
  if (raw[i] !== ':') return { end: i };
  return scanValues(raw, caret, raw.slice(keyStart, i), i + 1);
}

/** Walk the values from the colon to the caret, so a suggestion replaces the segment being typed. */
function scanValues(raw: string, caret: number, key: string, from: number): FacetValueContext | TokenEnd {
  let segment = from;
  let i = from;
  while (i < caret) {
    if (raw[i] === '"' && i === segment) {
      const close = raw.indexOf('"', i + 1);
      // An unclosed quote is a value still being typed — spaces and all, since it is what closes it.
      if (close < 0 || close >= caret) break;
      i = close + 1;
      if (raw[i] !== ',') return { end: i };
    }
    if (isSpace(raw[i])) return { end: i };
    // A `$` after the comma opens the next token, exactly as the parser reads it — so the key stage
    // takes over rather than the list offering values for a name.
    if (raw[i] === ',') {
      if (startsFacetToken(raw, i + 1)) return { end: i + 1 };
      segment = i + 1;
    }
    i++;
  }
  const quoted = raw[segment] === '"';
  return { stage: 'value', key, prefix: raw.slice(quoted ? segment + 1 : segment, caret), start: segment, end: caret };
}

/**
 * The whole vocabulary this surface can apply: the reserved names it names (all of them where it names
 * none), then every Facet key — from the client registry, never from the Facet read. A reserved name
 * wins its spelling, as it does at resolution.
 */
export function facetKeySuggestions(keys: FacetKeySet, prefix: string): readonly string[] {
  const reserved = keys.reserved ?? RESERVED_FACET_NAMES;
  const all = [...reserved, ...(keys.fields ?? []).filter((key) => !reserved.includes(key))];
  return rank(all, prefix, (key) => key);
}

/**
 * Whether this surface can apply `key` at all. The value stage is gated on it, so the Facet read never
 * leaks a key into the vocabulary: `EntityFacets.fields` is surfaced by presence (#231) and can carry
 * keys this registry lacks, which would offer counted values for a key the surface reports as a miss.
 */
export function resolvesFacetKey(keys: FacetKeySet, key: string): boolean {
  return (keys.reserved ?? RESERVED_FACET_NAMES).includes(key) || (keys.fields ?? []).includes(key);
}

/** One key's live values, or none — a key the read does not carry simply suggests nothing. */
export function facetValuesFor(facets: EntityFacets | null | undefined, key: string): readonly FacetCount[] {
  if (!facets) return [];
  const category = facetCategoryOf(key);
  if (category) return (category === 'container' ? facets.container : facets[category]) ?? [];
  return facets.fields.find((facet) => facet.key === key)?.values ?? [];
}

/**
 * The values worth offering for what has been typed. A value holding a double quote is dropped: the
 * grammar has no escape character (ADR-0082), so it is untypeable and stays reachable in the rail.
 */
export function facetValueSuggestions(values: readonly FacetCount[], prefix: string): readonly FacetCount[] {
  return rank(
    values.filter((v) => !v.value.includes('"')),
    prefix,
    (v) => v.value,
  );
}

/** Prefix matches first, then the ones that merely contain it, each in the order given. */
function rank<T>(items: readonly T[], prefix: string, textOf: (item: T) => string): readonly T[] {
  const needle = prefix.toLowerCase();
  const matches = items.filter((item) => textOf(item).toLowerCase().includes(needle));
  const starts = (item: T) => textOf(item).toLowerCase().startsWith(needle);
  return [...matches.filter(starts), ...matches.filter((item) => !starts(item))];
}

/**
 * The box with `choice` accepted where the caret stood, and where the caret lands after. A key gains
 * its colon, so the value stage opens straight after; a value is inserted **verbatim** — the case and
 * spacing it is stored in, quoted where the grammar needs it — because the parser does not case-fold,
 * and typeahead that did would disagree with the rail.
 */
export function applyFacetSuggestion(
  raw: string,
  context: FacetSuggestContext,
  choice: string,
): { text: string; caret: number } {
  const inserted = context.stage === 'key' ? choice + ':' : quoteFacetValue(choice);
  return {
    text: raw.slice(0, context.start) + inserted + raw.slice(context.end),
    caret: context.start + inserted.length,
  };
}

/** Quoted only where bare would mean something else: a space or comma would end it, a leading `<`, `>`
 * or `=` would read as a comparison, and a leading `$` would open the next token (ADR-0082). */
function quoteFacetValue(value: string): string {
  return /^$|[\s,]|^([<>=]|-?\$)/.test(value) ? `"${value}"` : value;
}

function isSpace(char: string | undefined): boolean {
  return char !== undefined && /\s/.test(char);
}
