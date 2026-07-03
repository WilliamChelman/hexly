import { Editor, JSONContent } from '@tiptap/core';
import { CONTENT_EXTENSIONS } from './content-extensions';

function freshEditor() {
  return new Editor({ extensions: CONTENT_EXTENSIONS });
}

function findEntityLink(json: JSONContent): JSONContent | undefined {
  return json.content?.[0]?.content?.find((n) => n.type === 'entityLink');
}

describe('entityLink node', () => {
  it('insertEntityLink inserts an inline entityLink carrying entityId and label', () => {
    const editor = freshEditor();
    editor.commands.insertEntityLink({ entityId: 'e1', label: 'Avalon' });
    const json = editor.getJSON();
    editor.destroy();

    const node = findEntityLink(json);
    expect(node).toBeDefined();
    expect(node?.attrs?.['entityId']).toBe('e1');
    expect(node?.attrs?.['label']).toBe('Avalon');
  });

  it('carries the optional display and heading attrs (ADR-0033 wikilink semantics)', () => {
    const editor = freshEditor();
    editor.commands.insertEntityLink({
      entityId: 'e1',
      label: 'Avalon',
      display: 'the White City',
      heading: 'History',
    });
    const json = editor.getJSON();
    editor.destroy();

    const node = findEntityLink(json);
    expect(node?.attrs?.['display']).toBe('the White City');
    expect(node?.attrs?.['heading']).toBe('History');
  });

  it('round-trips losslessly through the opaque save/reload cycle (ADR-0019)', () => {
    const editor = freshEditor();
    editor.commands.insertEntityLink({
      entityId: 'e1',
      label: 'Avalon',
      descriptor: 'capital of',
      display: 'the White City',
      heading: 'History',
    });
    const json = editor.getJSON();
    editor.destroy();

    const reloaded = freshEditor();
    reloaded.commands.setContent(json);
    const after = reloaded.getJSON();
    reloaded.destroy();

    expect(after).toEqual(json);
  });
});
