import {
  EntitySummary,
  FacetKeySet,
  ParsedFacetQuery,
  facetKeySuggestions,
  facetSuggestAt,
  parseFacetQuery,
} from '@hexly/domain';

/**
 * The Create row's sentinel id — `\0`-prefixed so it can never collide with an Entity id,
 * the same trick `vocabItems` uses for its "new" row.
 */
export const MENTION_CREATE_ID = '\0create';

/** The `Create "…" with details…` row's sentinel id — same `\0` trick, distinct row. */
export const MENTION_CREATE_DETAILS_ID = '\0create-details';

/** A Facet key row's id prefix — the same `\0` trick, one row per offered key. */
const MENTION_FACET_KEY_PREFIX = '\0facet:';

/** A row offering one of the owner's Entities, as the server's `q` search returned it. */
export interface MentionMatch {
  readonly kind: 'entity';
  readonly id: string;
  readonly entity: EntitySummary;
  /** The Link Descriptor typed alongside the mention, carried onto the inserted link. */
  readonly descriptor: string | null;
}

/** The `Create "…"` row: minting the typed name is a link like any other (ADR-0073). */
export interface MentionCreate {
  readonly kind: 'create';
  readonly id: typeof MENTION_CREATE_ID;
  /** The name to mint under — the query's name half, never its descriptor. */
  readonly name: string;
  readonly descriptor: string | null;
}

/**
 * The `Create "…" with details…` row: the same mint through the ordinary create dialog, for an author
 * who wants Types and Tags set before the thing exists (ADR-0073).
 */
export interface MentionCreateDetails {
  readonly kind: 'create-details';
  readonly id: typeof MENTION_CREATE_DETAILS_ID;
  readonly name: string;
  readonly descriptor: string | null;
}

/**
 * A Facet key on offer, and the slice of the mention query accepting it rewrites — offsets into the
 * query, which the trigger maps onto document positions.
 */
export interface MentionFacetKey {
  readonly kind: 'facet-key';
  readonly id: string;
  readonly key: string;
  readonly from: number;
  readonly to: number;
}

/** The rows one search produces: what matched, and what the typed name would mint. */
export type MentionSearchItem = MentionMatch | MentionCreate | MentionCreateDetails;

/** One row of the `@` picker's listbox. */
export type MentionItem = MentionSearchItem | MentionFacetKey;

/** A typed `@` query split into the name to match or mint, its Facet Tokens, and the Descriptor. */
export interface MentionQuery {
  /** The free text left after the tokens are lifted out — what matches, and what a Create row mints. */
  readonly name: string;
  readonly descriptor: string | null;
  /** The name half exactly as typed, tokens included: what one search is memoised on. */
  readonly raw: string;
  /** The **Facet Tokens** typed into the mention (ADR-0082) — `@$type:npc gorb` filters as it matches. */
  readonly facets: ParsedFacetQuery;
}

/**
 * Split `Zorblax::rival` into the name and the Link Descriptor typed alongside it (ADR-0073), then read
 * the name half for **Facet Tokens** (ADR-0082) — `@$type:npc gorb` narrows the picker to NPCs, and the
 * Create rows mint `gorb`, never the token that filtered. The `::` picker only arms *after* an
 * `entityLink` exists (ADR-0023), so a descriptor typed in the same breath as the mention reaches
 * nothing else — this is where it is read.
 *
 * `keys` is the vocabulary this surface can apply, read synchronously off the client registry: a `$`
 * name it does not answer to filters nothing, exactly as anywhere else.
 */
export function parseMentionQuery(query: string, keys: FacetKeySet): MentionQuery {
  const separator = query.indexOf('::');
  const raw = separator < 0 ? query : query.slice(0, separator);
  const facets = parseFacetQuery(raw, keys);
  return {
    name: facets.text,
    descriptor: separator < 0 ? null : query.slice(separator + 2).trim() || null,
    raw: raw.trim(),
    facets,
  };
}

/**
 * The Facet keys `$` reveals where the caret stands, and none anywhere else (ADR-0082) — the gesture
 * that answers "what can I even filter by?", here as ordinary picker rows. Synchronous, off the
 * registry the caller already holds: this surface runs no Facet read, so the key stage is the whole of
 * its typeahead — no values, no counts.
 *
 * `caret` is an offset into `query`, not its length: the mention matches to the end of the line, so a
 * caret left mid-mention has text after it that completes nothing.
 */
export function mentionFacetKeys(query: string, caret: number, keys: FacetKeySet): MentionFacetKey[] {
  // Past the `::` the caret is in the Link Descriptor (ADR-0073), which names no Facet.
  const separator = query.indexOf('::');
  if (separator >= 0 && caret > separator) return [];
  const context = facetSuggestAt(query, caret);
  if (context?.stage !== 'key') return [];
  return facetKeySuggestions(keys, context.prefix).map((key) => ({
    kind: 'facet-key',
    id: MENTION_FACET_KEY_PREFIX + key,
    key,
    from: context.start,
    to: context.end,
  }));
}

/**
 * The picker's rows for one query: the matches, then plain Create and Create-with-details — kept even
 * when something matches, since an existing "Jane Doe" must not block authoring a second one, and
 * ordered fast path first so Enter on a miss reaches the silent mint. Without `canCreate` both are
 * absent rather than present-and-failing (ADR-0073).
 */
export function mentionItems(
  query: Pick<MentionQuery, 'name' | 'descriptor'>,
  matches: readonly EntitySummary[],
  canCreate: boolean,
): MentionSearchItem[] {
  const items: MentionSearchItem[] = matches.map((entity) => ({
    kind: 'entity',
    id: entity.id,
    entity,
    descriptor: query.descriptor,
  }));
  if (query.name && canCreate) {
    items.push({ kind: 'create', id: MENTION_CREATE_ID, name: query.name, descriptor: query.descriptor });
    items.push({
      kind: 'create-details',
      id: MENTION_CREATE_DETAILS_ID,
      name: query.name,
      descriptor: query.descriptor,
    });
  }
  return items;
}
