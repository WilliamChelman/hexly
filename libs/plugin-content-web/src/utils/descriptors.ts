import { Editor } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { VocabItem, vocabItems } from '@hexly/plugin-content';

// Link Descriptors are harvested server-side from the saved Content (`harvestEdges` in
// @hexly/domain, run by the write path on every save), so this module only sets attrs on
// links: the `::`/`|`/`#` picker mechanics. Shared vocabulary rows live in vocab-items.ts.

/** Sentinel id for the "Remove" row — a `\0` prefix can never appear in typed text. */
const CLEAR_ID = '\0clear';

/**
 * Rows for the `|` display / `#` heading pickers (ADR-0033): the free-text siblings of
 * {@link vocabItems}, with no vocabulary. An empty query yields a clear row (`value: ''`,
 * which {@link setLinkAttr} treats as "un-set"), but only when `current` is already set —
 * nothing to remove on a fresh insert.
 */
export function linkTextRows(query: string, current: string | null): VocabItem[] {
  const rows = vocabItems(query, []);
  if (!query.trim() && current) {
    rows.unshift({ id: CLEAR_ID, value: '', isNew: false });
  }
  return rows;
}

/**
 * The `::` arm predicate (ADR-0023): the start position of the `entityLink` sitting
 * *immediately* before `pos`, or `null` when there is none — one character of separation
 * (a space, more prose) un-arms it, and `::` stays literal text everywhere else.
 */
export function entityLinkPosBefore(state: EditorState, pos: number): number | null {
  const before = state.doc.resolve(pos).nodeBefore;
  return before?.type.name === 'entityLink' ? pos - before.nodeSize : null;
}

/**
 * Set (or clear) a free-text attr of the `entityLink` at `linkPos`. Blank `value` clears
 * the attr. `range`, when given, is the `::query`/`|query`/`#query` match to remove; it is
 * deleted after the attr edit, which keeps `linkPos` valid (the link sits before the range).
 */
export function setLinkAttr(
  editor: Editor,
  linkPos: number,
  attr: 'descriptor' | 'display' | 'heading',
  value: string,
  range?: { from: number; to: number },
): void {
  const next = value.trim() || null;
  editor
    .chain()
    .command(({ tr }) => {
      tr.setNodeAttribute(linkPos, attr, next);
      if (range) tr.delete(range.from, range.to);
      return true;
    })
    .run();
}
