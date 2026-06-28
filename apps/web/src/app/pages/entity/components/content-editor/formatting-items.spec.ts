import { Editor } from '@tiptap/core';
import { CONTENT_EXTENSIONS } from './content-extensions';
import {
  FORMAT_ITEMS,
  FormatItem,
  applyLink,
  clearLink,
  isLinkActive,
} from './formatting-items';

function editorWith(text: string) {
  const editor = new Editor({ extensions: CONTENT_EXTENSIONS });
  editor.commands.setContent({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });
  // Select the whole paragraph text so a mark/node toggle has something to act on.
  editor.commands.setTextSelection({ from: 1, to: text.length + 1 });
  return editor;
}

const item = (id: string): FormatItem => FORMAT_ITEMS.find((i) => i.id === id)!;

describe('FORMAT_ITEMS', () => {
  // Each inline-mark control and the mark it should leave on the selected text.
  const markFor: Record<string, string> = {
    bold: 'bold',
    italic: 'italic',
    underline: 'underline',
    strike: 'strike',
    code: 'code',
  };

  for (const id of Object.keys(markFor)) {
    it(`"${id}" toggles the ${markFor[id]} mark and isActive tracks it`, () => {
      const editor = editorWith('Lady Mara');
      expect(item(id).isActive(editor)).toBe(false);

      item(id).run(editor);
      expect(item(id).isActive(editor)).toBe(true);

      const marks = editor.getJSON().content?.[0]?.content?.[0]?.marks ?? [];
      expect(marks.map((m) => m.type)).toContain(markFor[id]);
      editor.destroy();
    });
  }

  // Each block control and the top-level node type it should leave at the selection.
  const nodeFor: Record<string, string> = {
    heading1: 'heading',
    heading2: 'heading',
    heading3: 'heading',
    bulletList: 'bulletList',
    orderedList: 'orderedList',
  };

  for (const id of Object.keys(nodeFor)) {
    it(`"${id}" sets a ${nodeFor[id]} node and isActive tracks it`, () => {
      const editor = editorWith('Lady Mara');
      expect(item(id).isActive(editor)).toBe(false);

      item(id).run(editor);
      expect(item(id).isActive(editor)).toBe(true);

      const types = (editor.getJSON().content ?? []).map((n) => n.type);
      expect(types).toContain(nodeFor[id]);
      editor.destroy();
    });
  }

  it('links the selection to a URL, reflects it, and clears it', () => {
    const editor = editorWith('Lady Mara');
    expect(isLinkActive(editor)).toBe(false);

    applyLink(editor, 'https://example.com/mara');
    expect(isLinkActive(editor)).toBe(true);
    const marks = editor.getJSON().content?.[0]?.content?.[0]?.marks ?? [];
    const link = marks.find((m) => m.type === 'link');
    expect(link?.attrs?.['href']).toBe('https://example.com/mara');

    clearLink(editor);
    expect(isLinkActive(editor)).toBe(false);
    editor.destroy();
  });

  it('applies bold to the selection and round-trips through a fresh editor', () => {
    const editor = editorWith('Lady Mara');
    item('bold').run(editor);

    const json = editor.getJSON();
    editor.destroy();

    // The selected text now carries the bold mark.
    const marks = json.content?.[0]?.content?.[0]?.marks ?? [];
    expect(marks.map((m) => m.type)).toContain('bold');

    // Reloading the snapshot into a fresh editor yields identical JSON (ADR-0019).
    const reloaded = new Editor({ extensions: CONTENT_EXTENSIONS });
    reloaded.commands.setContent(json);
    const after = reloaded.getJSON();
    reloaded.destroy();
    expect(after).toEqual(json);
  });
});
