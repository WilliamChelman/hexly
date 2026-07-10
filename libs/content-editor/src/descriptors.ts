import { Editor } from '@tiptap/core';
import { EditorState } from '@tiptap/pm/state';
import { VocabItem, vocabItems } from './vocab-items';

// Link Descriptors are harvested server-side from the saved Content now — they fall out of
// `harvestEdges` in @hexly/domain, which the write path runs on every save (#96/ADR-0035,
// ADR-0046) — so the editor only sets them on links; this module is the `::`/`|`/`#` link-attr
// picker mechanics (the shared vocabulary rows live in vocab-items.ts).

/** Sentinel id for the "Remove" row — a `\0` prefix can never appear in typed text. */
const CLEAR_ID = '\0clear';

/**
 * Rows for the `|` display / `#` heading pickers (ADR-0033): the free-text siblings of
 * {@link vocabItems}, which have no vocabulary. A non-empty query yields the single
 * "set to X" row (via `vocabItems` over an empty vocab). An empty query yields a
 * **clear** row (`value: ''`, which {@link setLinkAttr} treats as "un-set") — but only
 * when `current` is already set, so it reads as "Remove" on an existing value and shows
 * nothing on a fresh insert. Typing a replacement drops the clear row and offers the edit.
 */
export function linkTextRows(query: string, current: string | null): VocabItem[] {
  const rows = vocabItems(query, []);
  if (!query.trim() && current) {
    rows.unshift({ id: CLEAR_ID, value: '', isNew: false });
  }
  return rows;
}

/**
 * The `::` arm predicate (#96, ADR-0023): the document position where an `entityLink`
 * sits *immediately* before `pos`, or `null` when it doesn't — i.e. `::` is literal
 * text everywhere except directly after a link. Resolving `pos` and reading `nodeBefore`
 * means one character of separation (a space, more prose) un-arms it, which is exactly
 * the "characterise the link you just inserted / moved behind" UX. The returned position
 * is the link node's start, ready for {@link setLinkDescriptor}.
 */
export function entityLinkPosBefore(state: EditorState, pos: number): number | null {
  const before = state.doc.resolve(pos).nodeBefore;
  return before?.type.name === 'entityLink' ? pos - before.nodeSize : null;
}

/**
 * Set (or clear) a free-text attr of the `entityLink` at `linkPos` — the shared
 * mechanism behind `::` descriptor (#96), `|` display and `#` heading (ADR-0033).
 * Blank text clears it (`Name (descriptor)` reverts to `Name`), so re-triggering and
 * picking nothing un-sets the attr. `range`, when given, is the `::query`/`|query`/`#query`
 * match the suggestion plugin wants removed; deleting it after the attr edit keeps
 * `linkPos` valid (the link sits before the range).
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
