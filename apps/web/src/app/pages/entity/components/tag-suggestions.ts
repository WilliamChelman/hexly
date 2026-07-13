import { vocabItems } from '@hexly/content-editor';

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
