/**
 * One row in any vocabulary-backed suggestion picker (`::` descriptor, `|`/`#` link text,
 * Tag): a matched vocab entry, or the typed free text.
 */
export interface VocabItem {
  /** Stable list key. */
  readonly id: string;
  /** The text to apply (descriptor, display, heading, or tag). */
  readonly value: string;
  /** True for the typed-but-unsaved entry shown as "create" — free text, never boxed in. */
  readonly isNew: boolean;
}

/**
 * Picker rows for a query over a candidate vocabulary: a case-insensitive substring filter,
 * with the typed text offered as a brand-new entry when it matches no existing one
 * (case-folded). An empty query lists the whole vocabulary and offers no "new" row.
 * The "new" item's `id` is `\0`-prefixed: a sentinel that can never appear in typed input,
 * so it cannot collide with a vocab entry.
 */
export function vocabItems(query: string, vocab: readonly string[]): VocabItem[] {
  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();
  const items: VocabItem[] = vocab
    .filter((v) => v.toLowerCase().includes(lower))
    .map((v) => ({ id: v, value: v, isNew: false }));
  if (trimmed && !vocab.some((v) => v.toLowerCase() === lower)) {
    items.unshift({ id: '\0new', value: trimmed, isNew: true });
  }
  return items;
}
