import { vocabItems } from '@hexly/plugin-content';

/** One row in the Tag entry picker: an owner-vocabulary tag, or the typed free text. */
export interface TagItem {
  /** Stable list key. */
  readonly id: string;
  /** The tag text to add. */
  readonly tag: string;
  /** True for the typed-but-unknown entry shown as "create" — free text, never boxed in. */
  readonly isNew: boolean;
}

/**
 * Tag entry suggestions: {@link vocabItems} matching (case-insensitive substring filter +
 * typed-text "new" row with the `\0` sentinel id), minus every tag already on the Entity (`added`)
 * — including the "new" row for a just-added tag, whose pick would be a silent no-op (deduped
 * away). So typing an existing/added tag yields nothing.
 */
export function tagItems(query: string, vocab: readonly string[], added: readonly string[]): TagItem[] {
  const addedSet = new Set(added.map((a) => a.toLowerCase()));
  return vocabItems(query, vocab)
    .filter((v) => !addedSet.has(v.value.toLowerCase()))
    .map((v) => ({ id: v.id, tag: v.value, isNew: v.isNew }));
}

/**
 * Fold free-text tag entry into `current`. Comma-splits for paste; trims, lower-cases and dedupes so the
 * form reads back what the server will store (entity.ts `dedupedTags`) rather than echoing it a beat
 * later. One rule, shared by the open Entity's tag editor and the create dialog's (ADR-0073) — two copies
 * of a normalization the server also owns is one drift too many.
 */
export function withTags(current: readonly string[], raw: string): readonly string[] {
  const incoming = raw
    .split(',')
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
  return incoming.length ? [...new Set([...current, ...incoming])] : current;
}
