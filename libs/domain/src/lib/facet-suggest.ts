/**
 * What a search box may **offer** where the caret stands (ADR-0082). Pressing `$` reveals the entire
 * filter vocabulary in one list — the single gesture that answers "what can I even filter by?" — and
 * after the key's colon the same list offers that Facet's values with their counts.
 *
 * Two stages, two sources, and the difference is load-bearing: **keys resolve synchronously** off the
 * client registry, while the Facet read feeds **values and counts only**, so a late response can make a
 * filter easier to type but can never change what one means. Everything here is pure text arithmetic —
 * the component owns the box and the keyboard, this owns what the box would say.
 */

import { EntityFacets, FacetCount } from './entity';
import { facetCategoryOf, FacetKeySet, RESERVED_FACET_NAMES } from './facet-token';

/** Which half of the vocabulary is being typed: the key, or one of its values. */
export type FacetSuggestStage = 'key' | 'value';

/**
 * The token the caret stands in, as far as the caret. `start`/`end` bound the slice an accepted
 * suggestion replaces — for a value opened with a quote, `start` is the quote itself, so completing it
 * replaces rather than nests.
 */
export interface FacetSuggestContext {
  readonly stage: FacetSuggestStage;
  /** The key already typed, on the value stage — what the caller looks its values up by. */
  readonly key?: string;
  /** What has been typed of the key or value so far; the list narrows on it. */
  readonly prefix: string;
  readonly start: number;
  readonly end: number;
}

/**
 * The suggestion context at `caret`, or `null` where the caret stands in plain text. Only the text
 * **before** the caret is read: the reader is typing here, and whatever follows is theirs to keep.
 */
export function facetSuggestAt(raw: string, caret: number): FacetSuggestContext | null {
  const start = tokenStart(raw, caret);
  if (start === null) return null;
  // Past the `-` that negates and the `$` that marks (ADR-0082: every token carries the `$`).
  const keyStart = start + (raw[start] === '-' ? 2 : 1);
  let i = keyStart;
  while (i < caret && raw[i] !== ':' && !isSpace(raw[i])) i++;
  if (i >= caret) return { stage: 'key', prefix: raw.slice(keyStart, caret), start: keyStart, end: caret };
  // A space before the colon ends the token: a `$` with no colon is a name, not yet a filter.
  if (raw[i] !== ':') return null;
  const key = raw.slice(keyStart, i);
  return valueContext(raw, caret, key, i + 1);
}

/**
 * Where the last token before `caret` begins, or `null` — a `$` mid-word starts nothing. Scanned
 * forwards rather than back from the caret, because a quoted value holds spaces (`$tag:"sea of `) and a
 * space is therefore no proof the token ended; the walk from here decides that.
 */
function tokenStart(raw: string, caret: number): number | null {
  let start: number | null = null;
  for (let i = 0; i < caret; i++) {
    if (raw[i] !== '$') continue;
    const negated = raw[i - 1] === '-';
    const from = negated ? i - 1 : i;
    if (from === 0 || isSpace(raw[from - 1])) start = from;
  }
  return start;
}

/** Walk the values from the colon to the caret, so the suggestion replaces the segment being typed. */
function valueContext(raw: string, caret: number, key: string, from: number): FacetSuggestContext | null {
  let segment = from;
  let i = from;
  while (i < caret) {
    if (raw[i] === '"' && i === segment) {
      const close = raw.indexOf('"', i + 1);
      // An unclosed quote is a value still being typed — spaces and all, since it is what closes it.
      if (close < 0 || close >= caret) break;
      i = close + 1;
      if (raw[i] !== ',') return null;
    }
    if (isSpace(raw[i])) return null;
    if (raw[i] === ',') segment = i + 1;
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

/** Quoted only where bare would mean something else: a space or comma would end it, `>=`/`<=` would
 * read as a bound (ADR-0082). */
export function quoteFacetValue(value: string): string {
  return /^$|[\s,]|^[<>]=/.test(value) ? `"${value}"` : value;
}

function isSpace(char: string | undefined): boolean {
  return char !== undefined && /\s/.test(char);
}
