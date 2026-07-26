import { Editor, JSONContent } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { CONTENT_EXTENSIONS } from './content-extensions';
import { takeMention } from './pending-mention';

/** The link a landed mint drops in — attrs as {@link entityLinkNode} declares them. */
const link = { type: 'entityLink', attrs: { entityId: 'e1', label: 'Zorblax', descriptor: null } };

/**
 * A note holding `text`, with the caret at its end — what an author has just typed. A literal text
 * node, not a string: typing never runs through the HTML parser, and the seed must not either.
 */
function editorWith(text: string): Editor {
  const editor = new Editor({ extensions: CONTENT_EXTENSIONS });
  editor.commands.insertContent({ type: 'text', text });
  return editor;
}

/** The suggestion range covering the whole of a note's single paragraph. */
const wholeParagraph = (editor: Editor) => ({ from: 1, to: editor.state.doc.content.size - 1 });

const hasLink = (json: JSONContent) => JSON.stringify(json).includes('entityLink');

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

describe('takeMention (ADR-0073)', () => {
  it('takes the typed text out of the prose before the write goes out', () => {
    const editor = editorWith('Feared by @Zorblax');

    takeMention(editor, { from: 11, to: 19 });

    expect(editor.getText()).toBe('Feared by ');
    editor.destroy();
  });

  it('lands the link where the mention was typed, not under the caret the author moved on to', () => {
    const editor = editorWith('Feared by @Zorblax');
    const pending = takeMention(editor, { from: 11, to: 19 });

    // The author keeps writing across the round trip.
    editor.commands.insertContent('and the wardens.');
    pending.land(link);

    expect(editor.getText()).toBe('Feared by and the wardens.');
    const paragraph = (editor.getJSON().content?.[0].content ?? []) as { type?: string; text?: string }[];
    expect(paragraph.map((node) => node.type)).toEqual(['text', 'entityLink', 'text']);
    expect(paragraph[0].text).toBe('Feared by ');
    editor.destroy();
  });

  it('restores the typed text verbatim — a name that looks like markup is not markup', () => {
    // A raw string is parsed as HTML on the way back in, and a tag the schema knows survives as a
    // *mark*: the literal `<b>` the author typed would come back as bold "Bob".
    const editor = editorWith('@Ser <b>Bob</b> Kensington');
    const pending = takeMention(editor, wholeParagraph(editor));

    pending.restore();

    expect(editor.getText()).toBe('@Ser <b>Bob</b> Kensington');
    expect(JSON.stringify(editor.getJSON())).not.toContain('bold');
    editor.destroy();
  });

  it('inserts nothing when undo put the typed text back while the write was still out', () => {
    const editor = editorWith('@Zorblax');
    // A pause reading the picker rows closes the history event, so the deletion is undoable on its own —
    // the case where Ctrl-Z mid-flight restores the text and a landing link would double it.
    editor.view.dispatch(closeHistory(editor.state.tr));
    const pending = takeMention(editor, wholeParagraph(editor));
    expect(editor.getText()).toBe('');

    editor.commands.undo();
    expect(editor.getText()).toBe('@Zorblax');

    pending.land(link);

    // Undo retracted the gesture: the sentence holds the typed text, once, and no link.
    expect(editor.getText()).toBe('@Zorblax');
    expect(hasLink(editor.getJSON())).toBe(false);
    editor.destroy();
  });

  it('does not restore the typed text a second time when undo already put it back', () => {
    const editor = editorWith('@Zorblax');
    editor.view.dispatch(closeHistory(editor.state.tr));
    const pending = takeMention(editor, wholeParagraph(editor));
    editor.commands.undo();

    pending.restore();

    expect(editor.getText()).toBe('@Zorblax');
    editor.destroy();
  });

  it('does not pull focus back into the prose when the write lands after the author moved on', async () => {
    const editor = editorWith('@Zorblax');
    const pending = takeMention(editor, wholeParagraph(editor));
    // The author is typing in the title (or the tag) input by the time the mint resolves.
    const elsewhere = document.createElement('input');
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    const stealFocus = vi.spyOn(editor.view, 'focus');

    pending.land(link);
    // TipTap's `focus()` defers to a requestAnimationFrame, so the theft is one frame late.
    await frame();

    expect(stealFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(elsewhere);
    // …and the link still landed where the mention was typed.
    expect(hasLink(editor.getJSON())).toBe(true);
    elsewhere.remove();
    editor.destroy();
  });

  it('settles into nothing once the editor is gone — a dialog may outlive the note it opened from', () => {
    const editor = editorWith('@Zorblax');
    const pending = takeMention(editor, wholeParagraph(editor));

    editor.destroy();

    expect(() => pending.land(link)).not.toThrow();
    expect(() => pending.restore()).not.toThrow();
  });

  it('stops tracking the document once it has settled', () => {
    const editor = editorWith('@Zorblax');
    const pending = takeMention(editor, wholeParagraph(editor));
    const before = editor.view.dom;

    pending.discard();
    editor.commands.insertContent('later prose');

    // Nothing left listening: `discard` leaves the hole and unbinds, so the `/link` `@` is simply gone.
    expect(editor.getText()).toBe('later prose');
    expect(editor.view.dom).toBe(before);
    editor.destroy();
  });
});
