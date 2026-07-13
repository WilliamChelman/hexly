import { tiptapContent } from './content';
import { extractText } from './extract-text';

describe('extractText (ADR-0035)', () => {
  it('collects the prose from a simple tiptap paragraph', () => {
    const content = tiptapContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Lady Aldermoor' }],
        },
      ],
    });

    expect(extractText(content)).toBe('Lady Aldermoor');
  });

  it('collects prose from deeply nested nodes across the tree', () => {
    const content = tiptapContent({
      type: 'doc',
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'The Reach' }] },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'ruled by ' },
                    {
                      type: 'text',
                      text: 'Lady Aldermoor',
                      marks: [{ type: 'bold' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(extractText(content)).toBe('The Reach ruled by Lady Aldermoor');
  });

  it('returns empty string for empty Content', () => {
    expect(extractText(tiptapContent({ type: 'doc', content: [] }))).toBe('');
  });

  it('returns empty string for an unknown/future format tag', () => {
    // Not a tiptap-* tag → indexed as no prose, never an error (forward-compatible).
    const content = {
      format: 'prosemirror-v9',
      snapshot: { text: 'ignored' },
    } as never;
    expect(extractText(content)).toBe('');
  });

  it('pulls plain text out of a mixed tiptap-v3 snapshot (callout, image, table, entityLink)', () => {
    // Representative of the ADR-0033 node set: node-type-agnostic collection means
    // none of these need per-node handling, and non-text nodes (image) contribute nothing.
    const content = tiptapContent({
      type: 'doc',
      content: [
        {
          type: 'callout',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Beware the deep.' }],
            },
          ],
        },
        { type: 'image', attrs: { src: 'asset://x', alt: 'a map' } },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'See ' },
            {
              type: 'entityLink',
              attrs: { entityId: 'e1' },
              content: [{ type: 'text', text: 'the Keep' }],
            },
          ],
        },
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  content: [
                    {
                      type: 'paragraph',
                      content: [{ type: 'text', text: 'North' }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(extractText(content)).toBe('Beware the deep. See the Keep North');
  });
});
