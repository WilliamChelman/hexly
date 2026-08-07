/**
 * **Facet Tokens** (CONTEXT.md → Facet Token, ADR-0082): a Facet named inline in an Entity search box
 * — `$type:npc`, `-$tag:draft`, `$cr:>=5` — rather than clicked in a rail. One pure function turns the
 * raw box string into the residual full-text query plus the structured filter params that already
 * exist; everything the grammar does not claim stays text, so a search for "Session 4: the ambush" is
 * still a search for that text.
 *
 * It takes its key set as an argument, so no surface's vocabulary is hard-coded here and the Palette's
 * smaller one needs no special case. The caller reads that set **synchronously** from its client
 * registry, never from the Facet read: a parser that changes its mind when a network read lands would
 * rewrite results while they are being read.
 */

import { FieldFilter } from './field';

/** The Facet categories a reserved name addresses — the wire's words, not the typed ones. */
export type FacetTokenCategory = 'type' | 'tag' | 'visibility' | 'container';

/**
 * The reserved names, in the spelling they are typed, mapped to the category each filters. `in` is the
 * **Container**'s typed name — it reads as a place, where `container` reads as a word to search for.
 */
const RESERVED: Readonly<Record<string, FacetTokenCategory>> = {
  type: 'type',
  tag: 'tag',
  visibility: 'visibility',
  in: 'container',
};

/** Every reserved name, the default offer for a surface whose key set names none. */
export const RESERVED_FACET_NAMES: readonly string[] = Object.keys(RESERVED);

/** The category a reserved name filters, or `undefined` for any other key — a Facet key of its own. */
export function facetCategoryOf(name: string): FacetTokenCategory | undefined {
  return RESERVED[name];
}

/**
 * One surface's Facet vocabulary. `reserved` is the subset of {@link RESERVED_FACET_NAMES} this surface
 * can actually apply — the Entity Browser is scoped to one World, so it offers no `in` and reports one
 * as a miss rather than dropping it silently. `fields` is every Facet key: Field ids and the dimensions
 * **Structured Data Types** harvest.
 */
export interface FacetKeySet {
  readonly reserved?: readonly string[];
  readonly fields?: readonly string[];
}

/** A per-category value list — always present, so a caller merges without a branch. */
export type FacetTokenValues = Readonly<Record<FacetTokenCategory, readonly string[]>>;

/**
 * Why a token that resolved to a known key still applied nothing: no value after the colon, a quote the
 * caller has not closed yet, or an excluded bound — which the wire cannot express (ADR-0081).
 */
export type FacetTokenMissReason = 'empty-value' | 'unterminated-quote' | 'negated-bound';

/** One resolvable token that filtered nothing, and why — a different message from an unknown key. */
export interface InapplicableFacetToken {
  readonly key: string;
  readonly reason: FacetTokenMissReason;
}

/**
 * What a box string means (ADR-0082): the `text` left to full-text search, the categories it includes
 * and excludes, the Field filters it names, and the tokens that answered to nothing — **reported** on
 * the surface, never quietly searched for and never quietly dropped.
 */
export interface ParsedFacetQuery {
  /** The residual full-text query: the box with every token lifted out, whitespace collapsed. */
  readonly text: string;
  readonly include: FacetTokenValues;
  readonly exclude: FacetTokenValues;
  /** The Facet-key constraints, in the `key`/`op`/`value` shape the `field` param already speaks. */
  readonly fields: readonly FieldFilter[];
  /** Each unresolvable `$` name, once, in the order typed. */
  readonly unresolvedKeys: readonly string[];
  /**
   * Each token whose key resolved but which applied no filter, once per key and reason. A token that
   * vanishes from the text without filtering would otherwise browse everything as if the box were empty.
   */
  readonly inapplicableTokens: readonly InapplicableFacetToken[];
}

/** One value written in a token: `quoted` says a comma inside it was literal, and a `>=` was too. */
interface ValueSegment {
  readonly value: string;
  readonly quoted: boolean;
  /** False for a quote the caller has not closed — a value still being typed, so not yet a filter. */
  readonly terminated: boolean;
  /** Where the segment was written, quotes included — what {@link removeFacetToken} cuts out. */
  readonly start: number;
  readonly end: number;
}

interface FacetToken {
  readonly key: string;
  readonly negated: boolean;
  readonly segments: readonly ValueSegment[];
  /** Where the token begins — at the `-` where it has one, so a cut takes the negation with it. */
  readonly start: number;
  /** Index just past the token, where scanning resumes. */
  readonly end: number;
}

export function parseFacetQuery(raw: string, keys: FacetKeySet): ParsedFacetQuery {
  const { reserved, fieldKeys } = vocabulary(keys);
  const include = emptyValues();
  const exclude = emptyValues();
  const fields: FieldFilter[] = [];
  const unresolvedKeys: string[] = [];
  const inapplicableTokens: InapplicableFacetToken[] = [];
  const text: string[] = [];

  // Start of the pending run of plain text, flushed whenever a token is lifted out.
  let plain = 0;
  for (const token of scanTokens(raw)) {
    text.push(raw.slice(plain, token.start));
    plain = token.end;
    // Reserved names win at resolution (ADR-0082), so a World Field labelled "Type" does not take
    // `$type` and is addressed by its full key.
    const category = reserved.has(token.key) ? RESERVED[token.key] : undefined;
    if (category) report(inapplicableTokens, token, applyCategory(token, category, include, exclude));
    else if (fieldKeys.has(token.key)) report(inapplicableTokens, token, applyField(token, fields));
    else if (!unresolvedKeys.includes(token.key)) unresolvedKeys.push(token.key);
  }
  text.push(raw.slice(plain));

  // An exclusion **vetoes** (ADR-0081), so a value named in both polarities renders and filters as the
  // exclusion alone — the rail shows one visual state per value, and it must be the one in force.
  for (const category of Object.keys(include) as FacetTokenCategory[])
    include[category] = include[category].filter((value) => !exclude[category].includes(value));

  return {
    text: text.join(' ').replace(/\s+/g, ' ').trim(),
    include,
    exclude,
    fields: fields.filter((f) => f.op !== 'eq' || !hasFilter(fields, f.key, 'neq', f.value)),
    unresolvedKeys,
    inapplicableTokens,
  };
}

/** Record a token that applied nothing, once per key and reason — one miss is one message. */
function report(misses: InapplicableFacetToken[], token: FacetToken, reason: FacetTokenMissReason | undefined): void {
  if (!reason || misses.some((m) => m.key === token.key && m.reason === reason)) return;
  misses.push({ key: token.key, reason });
}

/**
 * One value the rail displays, named the way a token names it: a reserved {@link FacetTokenCategory},
 * or a Facet key. The value is matched **exactly, case included** — the rail's rows carry the stored
 * value, which is what a token has to spell to have applied it.
 */
export type FacetTokenTarget =
  | { readonly category: FacetTokenCategory; readonly value: string }
  | { readonly field: string; readonly value: string };

/**
 * Take the token that named `target` out of the box (ADR-0082): the one rail→text write in the design,
 * and always a deletion, so everything applied stays reversible where it was named. Both polarities go
 * at once — a value is one rail row whichever way the box named it — and nothing else the caller typed
 * moves, only the removed token's own separator going with it.
 */
export function removeFacetToken(raw: string, keys: FacetKeySet, target: FacetTokenTarget): string {
  const { reserved, fieldKeys } = vocabulary(keys);
  const cuts: Cut[] = [];

  for (const token of scanTokens(raw)) {
    if (!addresses(token, target, reserved, fieldKeys)) continue;
    const named = token.segments.filter((segment) => names(segment, target));
    if (named.length === 0) continue;
    if (named.length === token.segments.length) cuts.push(withSeparator(raw, token.start, token.end));
    // One of several values in a comma list: only that value goes, and the list closes over it.
    else for (const segment of named) cuts.push(withComma(raw, segment.start, segment.end));
  }
  return applyCuts(raw, cuts);
}

/** Whether this token names the target's Facet at all — reserved names win, as they do at parse. */
function addresses(
  token: FacetToken,
  target: FacetTokenTarget,
  reserved: ReadonlySet<string>,
  fieldKeys: ReadonlySet<string>,
): boolean {
  if (reserved.has(token.key)) return 'category' in target && RESERVED[token.key] === target.category;
  return 'field' in target && fieldKeys.has(token.key) && token.key === target.field;
}

/**
 * Whether one written value is the target's. A bound is never a value: `>=5` filters, it does not name.
 * An `=` writes the membership a bare value writes, so `$cr:=5` names `5` and a click still deletes it.
 */
function names(segment: ValueSegment, target: FacetTokenTarget): boolean {
  if ('field' in target && !segment.quoted) {
    const written = comparisonOf(segment.value);
    if (written) return written.op === 'eq' && written.value === target.value;
  }
  return segment.value === target.value;
}

/** A half-open span of the box to delete. */
interface Cut {
  readonly from: number;
  readonly to: number;
}

/** A whole token takes one adjoining run of whitespace with it — after it, or else before it. */
function withSeparator(raw: string, from: number, to: number): Cut {
  // A token opened at a comma leaves with it, or the list would close over whatever follows the token.
  if (raw[from - 1] === ',') return { from: from - 1, to };
  let end = to;
  while (/\s/.test(raw[end] ?? '')) end++;
  if (end > to) return { from, to: end };
  let start = from;
  while (start > 0 && /\s/.test(raw[start - 1])) start--;
  return { from: start, to };
}

/** A value inside a comma list takes the comma that separated it — the following one, or else the one before. */
function withComma(raw: string, from: number, to: number): { from: number; to: number } {
  if (raw[to] === ',') return { from, to: to + 1 };
  if (raw[from - 1] === ',') return { from: from - 1, to };
  return { from, to };
}

/** Apply the cuts left to right; two that meet (adjacent tokens sharing a space) merge rather than double-cut. */
function applyCuts(raw: string, cuts: readonly { from: number; to: number }[]): string {
  let out = '';
  let at = 0;
  for (const cut of cuts) {
    if (cut.from > at) out += raw.slice(at, cut.from);
    at = Math.max(at, cut.to);
  }
  return out + raw.slice(at);
}

/** One surface's vocabulary as sets — the reserved names it offers, and its Facet keys. */
function vocabulary(keys: FacetKeySet): { reserved: ReadonlySet<string>; fieldKeys: ReadonlySet<string> } {
  return { reserved: new Set(keys.reserved ?? RESERVED_FACET_NAMES), fieldKeys: new Set(keys.fields ?? []) };
}

/** Every whole token in the box, left to right. The one walk of the grammar: reading a box and editing
 * one must not drift apart. */
function* scanTokens(raw: string): Generator<FacetToken> {
  let i = 0;
  while (i < raw.length) {
    const token = startsFacetToken(raw, i) ? readToken(raw, i) : null;
    if (!token) {
      i++;
      continue;
    }
    i = token.end;
    yield token;
  }
}

/**
 * A token begins at `$` (or the `-` that negates it) standing at a word boundary — nowhere else. The
 * boundary is whitespace, the start of the box, or a comma, so the rule holds inside a value list too
 * and `$tag:a,$tag:b` is two filters rather than a tag literally named `$tag:b`.
 * Exported so the typeahead reads the same boundary the parser does, rather than a second opinion of it.
 */
export function startsFacetToken(raw: string, i: number): boolean {
  if (i > 0 && !/[\s,]/.test(raw[i - 1])) return false;
  return raw[i] === '$' || (raw[i] === '-' && raw[i + 1] === '$');
}

/**
 * Read one whole token from `start`, or `null` where the grammar does not close — a `$` with no colon
 * is a name still being typed, and stays text until it has one.
 */
function readToken(raw: string, start: number): FacetToken | null {
  const negated = raw[start] === '-';
  let i = start + (negated ? 2 : 1); // past the `-` and the `$`
  const keyStart = i;
  while (i < raw.length && raw[i] !== ':' && !/\s/.test(raw[i])) i++;
  if (raw[i] !== ':' || i === keyStart) return null;
  const key = raw.slice(keyStart, i);
  const segments: ValueSegment[] = [];
  i++; // past the colon
  for (;;) {
    const from = i;
    if (raw[i] === '"') {
      // A quote left unclosed runs to the end of the box — there is no escape character, so nothing
      // else could close it. It reads as a value, but an unterminated one applies no filter.
      const close = raw.indexOf('"', i + 1);
      const value = raw.slice(i + 1, close < 0 ? raw.length : close);
      i = close < 0 ? raw.length : close + 1;
      segments.push({ value, quoted: true, terminated: close >= 0, start: from, end: i });
    } else {
      while (i < raw.length && raw[i] !== ',' && !/\s/.test(raw[i])) i++;
      segments.push({ value: raw.slice(from, i), quoted: false, terminated: true, start: from, end: i });
    }
    if (raw[i] !== ',') break;
    i++; // past the comma, which leaves with the list it separated
    if (startsFacetToken(raw, i)) break;
  }
  return { key, negated, segments, start, end: i };
}

/**
 * A reserved token's values, each taken literally — no category takes a range on the wire. Returns why
 * the token applied nothing, or `undefined` where at least one value named a filter.
 */
function applyCategory(
  token: FacetToken,
  category: FacetTokenCategory,
  include: Record<FacetTokenCategory, readonly string[]>,
  exclude: Record<FacetTokenCategory, readonly string[]>,
): FacetTokenMissReason | undefined {
  const bucket = token.negated ? exclude : include;
  let miss: FacetTokenMissReason | undefined;
  let applied = false;
  for (const segment of token.segments) {
    const reason = segmentMiss(segment, segment.value);
    if (reason) {
      miss ??= reason;
      continue;
    }
    applied = true;
    if (!bucket[category].includes(segment.value)) bucket[category] = [...bucket[category], segment.value];
  }
  return applied ? undefined : miss;
}

/**
 * A Facet key's values: membership, or a written comparison mapped onto the wire's ops. Returns why the
 * token applied nothing, as {@link applyCategory} does.
 */
function applyField(token: FacetToken, fields: FieldFilter[]): FacetTokenMissReason | undefined {
  let miss: FacetTokenMissReason | undefined;
  let applied = false;
  for (const segment of token.segments) {
    // A quoted value is literal, so `">=5"` names a value rather than comparing to one.
    const written = segment.quoted ? undefined : comparisonOf(segment.value);
    const value = written?.value ?? segment.value;
    // A range takes no polarity (ADR-0081): the wire has no negated bound, and "not >= 5" is not
    // "<= 5", so an excluded comparison is reported rather than answered with a filter nobody asked for.
    const range = written !== undefined && written.op !== 'eq';
    const reason = segmentMiss(segment, value) ?? (range && token.negated ? 'negated-bound' : undefined);
    if (reason) {
      miss ??= reason;
      continue;
    }
    // `=` writes the membership a bare value writes, so it still takes the token's polarity.
    const op = range ? written.op : token.negated ? 'neq' : 'eq';
    applied = true;
    if (!hasFilter(fields, token.key, op, value)) fields.push({ key: token.key, op, value });
  }
  return applied ? undefined : miss;
}

/** Why one written value applies nothing: a quote still open, or nothing left once its comparison is read. */
function segmentMiss(segment: ValueSegment, value: string): FacetTokenMissReason | undefined {
  if (!segment.terminated) return 'unterminated-quote';
  return value ? undefined : 'empty-value';
}

/**
 * The comparison a bare value opens with, mapped onto the wire's encoding, which the caller never meets.
 * Longest prefix first, so `>=` is not read as `>` followed by a value of `=5`.
 */
const COMPARISONS: readonly (readonly [string, FieldFilter['op']])[] = [
  ['>=', 'gte'],
  ['<=', 'lte'],
  ['>', 'gt'],
  ['<', 'lt'],
  ['=', 'eq'],
];

function comparisonOf(value: string): { op: FieldFilter['op']; value: string } | undefined {
  const written = COMPARISONS.find(([prefix]) => value.startsWith(prefix));
  return written && { op: written[1], value: value.slice(written[0].length) };
}

function hasFilter(fields: readonly FieldFilter[], key: string, op: FieldFilter['op'], value: string): boolean {
  return fields.some((f) => f.key === key && f.op === op && f.value === value);
}

function emptyValues(): Record<FacetTokenCategory, readonly string[]> {
  return { type: [], tag: [], visibility: [], container: [] };
}
