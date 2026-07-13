import { tiptapContent } from './content';
import { CONTENT_FIELD, CORE_RICH_CONTENT, RICH_CONTENT_DATA_TYPE } from './rich-content';

/** The prose value holding the given `entityLink` attrs, wrapped in a paragraph. */
function prose(...links: Record<string, unknown>[]) {
  return tiptapContent({
    type: 'doc',
    content: [{ type: 'paragraph', content: links.map((attrs) => ({ type: 'entityLink', attrs })) }],
  });
}

const harvest = (value: unknown) => RICH_CONTENT_DATA_TYPE.harvestEdges?.(value) ?? [];

describe('core.rich-content data-type (ADR-0051)', () => {
  it('declares the canonical content Field at the `content` key', () => {
    expect(CONTENT_FIELD.key).toBe('content');
    expect(CONTENT_FIELD.dataType).toEqual({ kind: CORE_RICH_CONTENT });
    expect(CONTENT_FIELD.facetable).toBe(false);
  });

  it('mints an empty document', () => {
    expect(RICH_CONTENT_DATA_TYPE.empty()).toEqual({ format: 'tiptap-v3', snapshot: { type: 'doc', content: [] } });
  });

  describe('harvestEdges — the inline Entity Links and image Assets', () => {
    it('reads a content entityLink as an edge to that Entity, carrying its Link Descriptor', () => {
      expect(harvest(prose({ entityId: 'mira', label: 'Mira', descriptor: 'spouse' }))).toEqual([
        { targetKind: 'entity', targetId: 'mira', descriptor: 'spouse' },
      ]);
    });

    it('trims the authored descriptor and treats a blank one as none', () => {
      expect(harvest(prose({ entityId: 'mira', descriptor: '  Capital Of  ' }))).toEqual([
        { targetKind: 'entity', targetId: 'mira', descriptor: 'Capital Of' },
      ]);
      expect(harvest(prose({ entityId: 'mira', descriptor: '  ' }))).toEqual([
        { targetKind: 'entity', targetId: 'mira', descriptor: null },
      ]);
    });

    it('ignores an entityLink that names no target, descriptor or not', () => {
      expect(harvest(prose({ entityId: null, label: 'Ghost', descriptor: 'rival' }))).toEqual([]);
      expect(harvest(prose({ label: 'Ghost' }))).toEqual([]);
    });

    it('reads an image at an Asset URL as an asset edge, and an external image as none', () => {
      const hash = 'a'.repeat(64);
      const value = tiptapContent({
        type: 'doc',
        content: [
          { type: 'image', attrs: { src: `/assets/world-1/${hash}.png` } },
          { type: 'image', attrs: { src: 'https://example.test/cat.png' } },
        ],
      });
      expect(harvest(value)).toEqual([{ targetKind: 'asset', targetId: hash, descriptor: null }]);
    });

    it('finds links nested deep in the document tree', () => {
      const value = tiptapContent({
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
                    content: [{ type: 'entityLink', attrs: { entityId: 'e1', descriptor: 'liege' } }],
                  },
                ],
              },
            ],
          },
        ],
      });
      expect(harvest(value)).toEqual([{ targetKind: 'entity', targetId: 'e1', descriptor: 'liege' }]);
    });

    it('reads no edges under a format tag this build cannot walk', () => {
      const alien = { format: 'prosemirror-v9', snapshot: { type: 'entityLink', attrs: { entityId: 'e1' } } };
      expect(harvest(alien)).toEqual([]);
    });

    it('harvests nothing from a malformed value at rest, rather than throwing', () => {
      expect(harvest('garbage')).toEqual([]);
    });
  });

  describe('extractText — the searchable prose', () => {
    it('collects the prose a document carries', () => {
      const value = tiptapContent({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Lady Aldermoor' }] }],
      });
      expect(RICH_CONTENT_DATA_TYPE.extractText?.(value)).toBe('Lady Aldermoor');
    });

    it('contributes nothing from a value at rest it cannot parse', () => {
      expect(RICH_CONTENT_DATA_TYPE.extractText?.('garbage')).toBe('');
    });
  });
});
