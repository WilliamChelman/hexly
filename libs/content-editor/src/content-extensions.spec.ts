import { Editor, JSONContent } from '@tiptap/core';
import { CONTENT_EXTENSIONS } from './content-extensions';

/**
 * The extension set is the `tiptap-v3` format contract (ADR-0019/0033): ProseMirror
 * silently drops content for any node/mark not registered here, so "the node loads"
 * is verified by round-tripping a doc that uses it and asserting it survives.
 */
function survives(doc: JSONContent): JSONContent {
  const editor = new Editor({ extensions: CONTENT_EXTENSIONS, content: doc });
  const json = editor.getJSON();
  editor.destroy();
  return json;
}

function hasNode(json: JSONContent, type: string): boolean {
  if (json.type === type) return true;
  if (json.marks?.some((m) => m.type === type)) return true;
  return (json.content ?? []).some((c) => hasNode(c, type));
}

function renderHtml(doc: JSONContent): string {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: CONTENT_EXTENSIONS,
    content: doc,
  });
  const html = editor.getHTML();
  editor.destroy();
  return html;
}

function countNode(json: JSONContent, type: string): number {
  const self = json.type === type ? 1 : 0;
  return self + (json.content ?? []).reduce((n, c) => n + countNode(c, type), 0);
}

describe('CONTENT_EXTENSIONS — tiptap-v3 schema', () => {
  it('loads the highlight mark losslessly', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'lit', marks: [{ type: 'highlight' }] }],
        },
      ],
    };
    expect(hasNode(survives(doc), 'highlight')).toBe(true);
  });

  it('loads the image node losslessly, carrying its src', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'image', attrs: { src: '/assets/w1/abc.png' } }],
    };
    const json = survives(doc);
    expect(hasNode(json, 'image')).toBe(true);
    expect(json.content?.[0]?.attrs?.['src']).toBe('/assets/w1/abc.png');
  });

  it('loads a table losslessly', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'H' }],
                    },
                  ],
                },
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'c' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    };
    expect(hasNode(survives(doc), 'table')).toBe(true);
  });

  it('loads a task list losslessly, keeping the checked state', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'done' }],
                },
              ],
            },
          ],
        },
      ],
    };
    const json = survives(doc);
    expect(hasNode(json, 'taskList')).toBe(true);
    expect(json.content?.[0]?.content?.[0]?.attrs?.['checked']).toBe(true);
  });

  it('renders a listItem holding sibling bulletList+taskList runs faithfully — plain items stay bullets, not checkboxes (#149)', () => {
    // The shape a mixed Obsidian list imports to (ADR-0033): one listItem whose
    // body interleaves plain bullets and task runs. TipTap must keep the plain
    // items as listItems (bullets, no checkbox) and only the tasks as taskItems.
    const li = (text: string) => ({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    });
    const ti = (text: string) => ({
      type: 'taskItem',
      attrs: { checked: true },
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    });
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Chrysee' }],
                },
                { type: 'bulletList', content: [li('CA 15-'), li('immunite')] },
                { type: 'taskList', content: [ti('gwayn')] },
                { type: 'bulletList', content: [li('biiiim')] },
                { type: 'taskList', content: [ti('Bigby')] },
              ],
            },
          ],
        },
      ],
    };

    const json = survives(doc);
    // Only the two `- [ ]` items are tasks; the three prose bullets stay listItems.
    expect(countNode(json, 'taskItem')).toBe(2);

    const html = renderHtml(doc);
    // Exactly two checkboxes render — one per task, none on the plain bullets.
    expect((html.match(/type="checkbox"/g) ?? []).length).toBe(2);
  });

  it('loads a callout losslessly — its type/title attrs and live inner links (ADR-0033)', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'callout',
          attrs: { type: 'warning', title: 'Beware' },
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'See ' },
                {
                  type: 'entityLink',
                  attrs: { entityId: 'e1', label: 'Avalon' },
                },
              ],
            },
          ],
        },
      ],
    };
    const json = survives(doc);
    const callout = json.content?.[0];
    expect(callout?.type).toBe('callout');
    expect(callout?.attrs?.['type']).toBe('warning');
    expect(callout?.attrs?.['title']).toBe('Beware');
    // Block content, not an atom: the inner entityLink stays a live node.
    expect(hasNode(json, 'entityLink')).toBe(true);
  });
});
