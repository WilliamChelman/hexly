import { proseMirrorToMarkdown } from './prose-mirror-to-markdown';
import { markdownToProseMirror, type PMNode } from './markdown-to-prose-mirror';

const doc = (...content: PMNode[]): PMNode => ({ type: 'doc', content });

describe('proseMirrorToMarkdown', () => {
  it('emits a paragraph as its text', () => {
    const md = proseMirrorToMarkdown(
      doc({
        type: 'paragraph',
        content: [{ type: 'text', text: 'Hello world' }],
      }),
    );

    expect(md.trim()).toBe('Hello world');
  });

  it('re-emits metadata as YAML frontmatter', () => {
    const md = proseMirrorToMarkdown(doc({ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }), {
      title: 'Hello',
      tags: ['a', 'b'],
    });

    expect(md).toMatch(/^---\ntitle: Hello\ntags:\n {2}- a\n {2}- b\n---/);
    // and it round-trips back through the importer
    expect(markdownToProseMirror(md).metadata).toEqual({
      title: 'Hello',
      tags: ['a', 'b'],
    });
  });

  it('keeps literal bracket text escaped instead of reviving it as a wikilink/callout/footnote', () => {
    const md = proseMirrorToMarkdown(
      doc({
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: '[[not a link]] and [!not a callout] and [^not a footnote]',
          },
        ],
      }),
    );

    expect(md.trim()).toBe('\\[\\[not a link]] and \\[!not a callout] and \\[^not a footnote]');
  });

  it('re-emits an entityLink as a wikilink with display and heading', () => {
    const md = proseMirrorToMarkdown(
      doc({
        type: 'paragraph',
        content: [
          {
            type: 'entityLink',
            attrs: {
              entityId: 'x',
              label: 'Alice',
              display: 'Al',
              heading: 'Bio',
            },
          },
        ],
      }),
    );

    expect(md.trim()).toBe('[[Alice#Bio|Al]]');
  });

  it('joins every text child of a code block, not just the first', () => {
    const md = proseMirrorToMarkdown(
      doc({
        type: 'codeBlock',
        attrs: { language: 'ts' },
        content: [
          { type: 'text', text: 'const x = 1;' },
          { type: 'text', text: '\nconst y = 2;' },
        ],
      }),
    );

    expect(md).toContain('const x = 1;\nconst y = 2;');
  });

  it('emits every block in a table cell, not just the first', () => {
    const md = proseMirrorToMarkdown(
      doc({
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
                    content: [{ type: 'text', text: 'first' }],
                  },
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: 'second' }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );

    expect(md).toContain('first');
    expect(md).toContain('second');
  });

  it('re-emits a callout with its [!type] header', () => {
    const md = proseMirrorToMarkdown(
      doc({
        type: 'callout',
        attrs: { type: 'tip', title: 'Heads up' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'body' }] }],
      }),
    );

    expect(md).toContain('> [!tip] Heads up');
    expect(md).toContain('> body');
  });
});
