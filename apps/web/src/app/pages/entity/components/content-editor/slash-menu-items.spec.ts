import { Editor } from '@tiptap/core';
import { CONTENT_EXTENSIONS } from './content-extensions';
import { SLASH_ITEMS, SlashItem, filterSlashItems } from './slash-menu-items';

describe('filterSlashItems', () => {
  it('returns every item for an empty query', () => {
    expect(filterSlashItems(SLASH_ITEMS, '')).toEqual(SLASH_ITEMS);
  });

  it('matches items by keyword, case-insensitively', () => {
    const result = filterSlashItems(SLASH_ITEMS, 'TITLE');

    // "title" is a keyword on the heading items.
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((item) => item.id.startsWith('heading'))).toBe(true);
  });

  it('normalizes keyword case when matching (keyword side)', () => {
    const item: SlashItem = { id: 'x', labelKey: 'x', keywords: ['MyKeyword'], apply: () => void 0 };
    expect(filterSlashItems([item], 'mykeyword')).toHaveLength(1);
  });

  it('returns nothing when query matches no blocks', () => {
    expect(filterSlashItems(SLASH_ITEMS, 'zzzznope')).toEqual([]);
  });
});

describe('SlashItem.apply', () => {
  // The node type each item should leave at the top of the document.
  const expectedNode: Record<string, string> = {
    text: 'paragraph',
    heading1: 'heading',
    heading2: 'heading',
    heading3: 'heading',
    bulletList: 'bulletList',
    orderedList: 'orderedList',
    blockquote: 'blockquote',
    codeBlock: 'codeBlock',
    horizontalRule: 'horizontalRule',
  };

  function applyToFreshDoc(id: string) {
    const item = SLASH_ITEMS.find((i) => i.id === id)!;
    const editor = new Editor({ extensions: CONTENT_EXTENSIONS });
    editor.commands.insertContent('/heading');
    item.apply(editor, { from: 1, to: editor.state.doc.content.size });
    const json = editor.getJSON();
    editor.destroy();
    return json;
  }

  for (const id of Object.keys(expectedNode)) {
    it(`inserts a ${expectedNode[id]} node for "${id}"`, () => {
      const json = applyToFreshDoc(id);
      const types = (json.content ?? []).map((n) => n.type);
      expect(types).toContain(expectedNode[id]);
    });
  }

  it('routes "/link" into the @ picker by inserting an "@" trigger (issue #95)', () => {
    const item = SLASH_ITEMS.find((i) => i.id === 'link')!;
    const editor = new Editor({ extensions: CONTENT_EXTENSIONS });
    editor.commands.insertContent('/link');
    item.apply(editor, { from: 1, to: editor.state.doc.content.size });
    const text = editor.state.doc.textContent;
    editor.destroy();

    expect(text).toBe('@');
  });

  it('produces a snapshot that round-trips losslessly through the editor', () => {
    const json = applyToFreshDoc('heading2');

    const reloaded = new Editor({ extensions: CONTENT_EXTENSIONS });
    reloaded.commands.setContent(json);
    const after = reloaded.getJSON();
    reloaded.destroy();

    expect(after).toEqual(json);
  });
});
