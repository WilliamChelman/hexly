import { EntitySummary } from '@hexly/domain';

/**
 * The Create row's sentinel id — `\0`-prefixed so it can never collide with an Entity id,
 * the same trick `vocabItems` uses for its "new" row.
 */
export const MENTION_CREATE_ID = '\0create';

/** The `Create "…" with details…` row's sentinel id — same `\0` trick, distinct row. */
export const MENTION_CREATE_DETAILS_ID = '\0create-details';

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

/** One row of the `@` picker's listbox. */
export type MentionItem = MentionMatch | MentionCreate | MentionCreateDetails;

/** A typed `@` query split into the name to match or mint and the Link Descriptor riding with it. */
export interface MentionQuery {
  readonly name: string;
  readonly descriptor: string | null;
}

/**
 * Split `Zorblax::rival` into the name and the Link Descriptor typed alongside it (ADR-0073).
 * The `::` picker only arms *after* an `entityLink` exists (ADR-0023), so a descriptor typed in
 * the same breath as the mention reaches nothing else — this is where it is read.
 */
export function parseMentionQuery(query: string): MentionQuery {
  const separator = query.indexOf('::');
  if (separator < 0) return { name: query.trim(), descriptor: null };
  return {
    name: query.slice(0, separator).trim(),
    descriptor: query.slice(separator + 2).trim() || null,
  };
}

/**
 * The picker's rows for one query: the server's matches, then the two Create rows — appended **even when
 * there are matches**, because an existing "Jane Doe" must not block authoring a second, different
 * one, and the first of them active when nothing matches, so Enter never does nothing (ADR-0073).
 *
 * Order is the fast path first: plain Create is what Enter reaches on a miss, and the details row sits
 * below it as the one you go looking for.
 */
export function mentionItems(query: MentionQuery, matches: readonly EntitySummary[]): MentionItem[] {
  const items: MentionItem[] = matches.map((entity) => ({
    kind: 'entity',
    id: entity.id,
    entity,
    descriptor: query.descriptor,
  }));
  if (query.name) {
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
