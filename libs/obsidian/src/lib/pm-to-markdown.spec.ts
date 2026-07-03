import { proseMirrorToMarkdown } from './pm-to-markdown';
import { markdownToProseMirror, type PMNode } from './markdown-to-pm';

const doc = (...content: PMNode[]): PMNode => ({ type: 'doc', content });

describe('proseMirrorToMarkdown', () => {
  it('emits a paragraph as its text', () => {
    const md = proseMirrorToMarkdown(
      doc({ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] })
    );

    expect(md.trim()).toBe('Hello world');
  });

  it('re-emits metadata as YAML frontmatter', () => {
    const md = proseMirrorToMarkdown(
      doc({ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }),
      { title: 'Hello', tags: ['a', 'b'] }
    );

    expect(md).toMatch(/^---\ntitle: Hello\ntags:\n {2}- a\n {2}- b\n---/);
    // and it round-trips back through the importer
    expect(markdownToProseMirror(md).metadata).toEqual({ title: 'Hello', tags: ['a', 'b'] });
  });

  it('re-emits an entityLink as a wikilink with display and heading', () => {
    const md = proseMirrorToMarkdown(
      doc({
        type: 'paragraph',
        content: [
          { type: 'entityLink', attrs: { entityId: 'x', label: 'Alice', display: 'Al', heading: 'Bio' } },
        ],
      })
    );

    expect(md.trim()).toBe('[[Alice#Bio|Al]]');
  });

  it('re-emits a callout with its [!type] header', () => {
    const md = proseMirrorToMarkdown(
      doc({
        type: 'callout',
        attrs: { type: 'tip', title: 'Heads up' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'body' }] }],
      })
    );

    expect(md).toContain('> [!tip] Heads up');
    expect(md).toContain('> body');
  });
});
