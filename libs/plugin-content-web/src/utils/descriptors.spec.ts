import { Editor, JSONContent } from '@tiptap/core';
import { CONTENT_EXTENSIONS } from '../extensions/content-extensions';
import { entityLinkPosBefore, linkTextRows, setLinkAttr } from './descriptors';

function freshEditor() {
  return new Editor({ extensions: CONTENT_EXTENSIONS });
}

function linkAttrs(editor: Editor): JSONContent['attrs'] {
  const json: JSONContent = editor.getJSON();
  return json.content?.[0]?.content?.find((n) => n.type === 'entityLink')?.attrs;
}

describe('entityLinkPosBefore — the `::` arm predicate', () => {
  it('finds the link position when an entityLink sits immediately before the cursor', () => {
    const editor = freshEditor();
    editor.commands.insertEntityLink({ entityId: 'e1', label: 'Jane' });
    const pos = entityLinkPosBefore(editor.state, editor.state.selection.from);
    editor.destroy();

    expect(pos).toBe(1);
  });

  it('returns null in plain prose — `::` is then literal text', () => {
    const editor = freshEditor();
    editor.commands.insertContent('just some words');
    const pos = entityLinkPosBefore(editor.state, editor.state.selection.from);
    editor.destroy();

    expect(pos).toBeNull();
  });

  it('returns null once a character separates the cursor from the link', () => {
    const editor = freshEditor();
    editor.commands.insertEntityLink({ entityId: 'e1', label: 'Jane' });
    editor.commands.insertContent(' '); // a space now sits between link and cursor
    const pos = entityLinkPosBefore(editor.state, editor.state.selection.from);
    editor.destroy();

    expect(pos).toBeNull();
  });
});

describe('setLinkAttr — set/change/clear', () => {
  let editor: Editor;
  afterEach(() => editor.destroy());

  it('sets the descriptor on the link at the given position', () => {
    editor = freshEditor();
    editor.commands.insertEntityLink({ entityId: 'e1', label: 'Jane' });
    setLinkAttr(editor, 1, 'descriptor', 'spouse');

    expect(linkAttrs(editor)?.['descriptor']).toBe('spouse');
  });

  it('changes an already-set descriptor when applied again', () => {
    editor = freshEditor();
    editor.commands.insertEntityLink({
      entityId: 'e1',
      label: 'Jane',
      descriptor: 'spouse',
    });
    setLinkAttr(editor, 1, 'descriptor', 'rival');

    expect(linkAttrs(editor)?.['descriptor']).toBe('rival');
  });

  it('clears the descriptor when applied with empty/blank text', () => {
    editor = freshEditor();
    editor.commands.insertEntityLink({
      entityId: 'e1',
      label: 'Jane',
      descriptor: 'spouse',
    });
    setLinkAttr(editor, 1, 'descriptor', '   ');

    expect(linkAttrs(editor)?.['descriptor'] ?? null).toBeNull();
  });

  it('sets the display override text on the link (`[[Target|display]]`, ADR-0033)', () => {
    editor = freshEditor();
    editor.commands.insertEntityLink({ entityId: 'e1', label: 'Jane' });
    setLinkAttr(editor, 1, 'display', 'my wife');

    expect(linkAttrs(editor)?.['display']).toBe('my wife');
  });

  it('sets the heading anchor on the link (`[[Target#Heading]]`, ADR-0033)', () => {
    editor = freshEditor();
    editor.commands.insertEntityLink({ entityId: 'e1', label: 'Jane' });
    setLinkAttr(editor, 1, 'heading', 'Early life');

    expect(linkAttrs(editor)?.['heading']).toBe('Early life');
  });

  it('clears the heading when applied with blank text', () => {
    editor = freshEditor();
    editor.commands.insertEntityLink({
      entityId: 'e1',
      label: 'Jane',
      heading: 'Early life',
    });
    setLinkAttr(editor, 1, 'heading', '');

    expect(linkAttrs(editor)?.['heading'] ?? null).toBeNull();
  });
});

describe('linkTextRows — `|`/`#` free-text rows with a clear affordance', () => {
  it('offers only the typed text as a new value', () => {
    const rows = linkTextRows('my wife', null);
    expect(rows).toEqual([{ id: expect.any(String), value: 'my wife', isNew: true }]);
  });

  it('offers a clear row on an empty query when the attr is already set', () => {
    const rows = linkTextRows('', 'my wife');
    expect(rows).toEqual([{ id: expect.any(String), value: '', isNew: false }]);
  });

  it('offers nothing on an empty query when the attr is unset (plain insert)', () => {
    expect(linkTextRows('   ', null)).toEqual([]);
  });

  it('drops the clear row once the user types a replacement', () => {
    const rows = linkTextRows('new text', 'old');
    expect(rows).toEqual([{ id: expect.any(String), value: 'new text', isNew: true }]);
  });
});
