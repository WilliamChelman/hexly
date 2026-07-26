import { Editor } from '@tiptap/core';
import { Transaction } from '@tiptap/pm/state';

/** What lands where the mention was typed: the `entityLink` node, or the typed text going back. */
export type MentionContent = Parameters<Editor['commands']['insertContentAt']>[1];

/**
 * A mention whose text has been taken out of the prose and whose write is still in flight. Exactly one
 * of the three settles it; a second call is a no-op, and so is any of them once the editor is gone.
 */
export interface PendingMention {
  /** Drop the minted link where the mention was typed. */
  land(content: MentionContent): void;
  /** Put the typed text back, character for character — a failed write, or a declined dialog. */
  restore(): void;
  /** Settle with nothing: the `@` was ours to remove (`/link`), so the hole is the right outcome. */
  discard(): void;
}

/**
 * Take the typed mention out of the prose now and hold its place until the write comes back.
 *
 * The text goes *before* the await because `@tiptap/suggestion` fires `onExit` the instant the popup
 * closes, so the suggestion range is dead by the time the write lands (ADR-0073) — which is also what
 * lets the details row's dialog outlive the popup. The insertion point is the captured one, mapped
 * through every transaction since: the author keeps writing across the round trip, and the link belongs
 * in the sentence they left it in, not under the caret they have since moved.
 *
 * **Undo during the flight retracts the gesture.** The deletion is an ordinary transaction, so Ctrl-Z
 * can put the typed text back mid-mint; a settle that finds it back inserts nothing, rather than leaving
 * the sentence holding both. The Entity may already exist — an orphan is the disclosed cost, corrupt
 * prose is not.
 */
export function takeMention(editor: Editor, range: { from: number; to: number }): PendingMention {
  const typed = editor.state.doc.textBetween(range.from, range.to);
  // No `.focus()` anywhere in here (see {@link insertAt}): the caret is already in the prose — a picker
  // row swallows `mousedown` so even a mouse pick leaves it there — so focusing is a no-op at best.
  editor.chain().deleteRange(range).run();

  // Bias left (-1): text the author types at this very position belongs *after* the pending link,
  // so the mention keeps its place in the sentence rather than being pushed to the end of it.
  let at = range.from;
  const track = ({ transaction }: { transaction: Transaction }) => (at = transaction.mapping.map(at, -1));
  const release = () => {
    editor.off('transaction', track);
    editor.off('destroy', release);
  };
  editor.on('transaction', track);
  // A write may never come back at all — a details dialog can be left open, or fail — so the tracker is
  // bound to the surface's life rather than the attempt's: a destroyed editor ends it.
  editor.on('destroy', release);

  const settle = (insert: (at: number) => void): void => {
    release();
    if (editor.isDestroyed || undone(editor, at, typed)) return;
    insert(at);
  };

  return {
    land: (content) => settle((at) => insertAt(editor, at, content)),
    // A literal text node, never the raw string: TipTap parses a string as HTML, so a name carrying
    // markup-shaped text — `@Ser <b>Bob</b> Kensington` — comes back marked up and short its tags.
    restore: () => settle((at) => insertAt(editor, at, { type: 'text', text: typed })),
    discard: () => release(),
  };
}

/** Whether the typed text is back where it was taken from — an undo of the deletion, mid-flight. */
function undone(editor: Editor, at: number, typed: string): boolean {
  const end = at + typed.length;
  if (!typed || end > editor.state.doc.content.size) return false;
  return editor.state.doc.textBetween(at, end) === typed;
}

/**
 * Insert at a tracked position without moving the caret: the author owns it. With nothing typed since,
 * `at` *is* the caret, and mapping carries it past the new node — so the ordinary case still lands the
 * cursor after the link.
 *
 * Deliberately no `.focus()`: it is a no-op while the editor has focus and a *theft* when it does not —
 * TipTap's `focus()` falls through to a `requestAnimationFrame` that calls `view.focus()` and
 * `scrollIntoView()`, which would yank the caret out of the title or tag input an author moved to while
 * the mint was in flight.
 */
function insertAt(editor: Editor, at: number, content: MentionContent): void {
  editor.chain().insertContentAt(at, content, { updateSelection: false }).run();
}
