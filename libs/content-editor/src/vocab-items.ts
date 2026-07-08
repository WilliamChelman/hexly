/**
 * One row in any vocabulary-backed suggestion picker: a matched vocab entry, or the typed
 * free text. Shared by the `::` descriptor picker (#96), the `|`/`#` link-text pickers
 * (ADR-0033) and the Tag picker — hence the neutral `value` (the descriptor / display /
 * heading / tag to apply).
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
 * (case-folded) — so the user is never boxed into the suggestions. An empty query lists the
 * whole vocabulary and offers no "new" row (there's nothing typed yet). The "new" item's
 * `id` uses a `\0` prefix as a sentinel that can never appear in typed input (no null
 * bytes), so it can't collide with any vocab entry. Reused by every picker that has a
 * vocabulary (the `::` descriptor picker and the Tag picker); the `|`/`#` link-text pickers
 * call it with an empty vocab for their single typed row.
 */
export function vocabItems(
  query: string,
  vocab: readonly string[],
): VocabItem[] {
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
