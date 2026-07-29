import {
  CONTENT_FIELD,
  CORE_RICH_CONTENT,
  RICH_CONTENT_DATA_TYPE,
  richContentSchema,
  emptyRichContent,
  tiptapContent,
} from './rich-content';

/** The prose value holding the given `entityLink` attrs, wrapped in a paragraph. */
function prose(...links: Record<string, unknown>[]) {
  return tiptapContent({
    type: 'doc',
    content: [{ type: 'paragraph', content: links.map((attrs) => ({ type: 'entityLink', attrs })) }],
  });
}

const harvest = (value: unknown) => RICH_CONTENT_DATA_TYPE.harvestEdges?.(value) ?? [];

describe('core.datatype.rich-content data-type (ADR-0051)', () => {
  it('declares the canonical content Field at the `core.field.content` key', () => {
    expect(CONTENT_FIELD.id).toBe('core.field.content');
    expect(CONTENT_FIELD.dataType).toEqual({ kind: CORE_RICH_CONTENT });
    expect(CONTENT_FIELD.facetable).toBe(false);
  });

  it('mints an empty document', () => {
    expect(RICH_CONTENT_DATA_TYPE.empty()).toEqual({ format: 'tiptap-v3', snapshot: { type: 'doc', content: [] } });
  });

  describe('harvestEdges — the inline Entity Links and image Assets', () => {
    it('reads a content entityLink as a semantic edge to that Entity, carrying its Link Descriptor', () => {
      // A prose Entity Link is always semantic (ADR-0069): authored meaning, never decor.
      expect(harvest(prose({ entityId: 'mira', label: 'Mira', descriptor: 'spouse' }))).toEqual([
        { targetKind: 'entity', targetId: 'mira', targetContainerId: null, descriptor: 'spouse', decor: false },
      ]);
    });

    it('trims the authored descriptor and treats a blank one as none', () => {
      expect(harvest(prose({ entityId: 'mira', descriptor: '  Capital Of  ' }))).toEqual([
        { targetKind: 'entity', targetId: 'mira', targetContainerId: null, descriptor: 'Capital Of', decor: false },
      ]);
      expect(harvest(prose({ entityId: 'mira', descriptor: '  ' }))).toEqual([
        { targetKind: 'entity', targetId: 'mira', targetContainerId: null, descriptor: null, decor: false },
      ]);
    });

    it('ignores an entityLink that names no target, descriptor or not', () => {
      expect(harvest(prose({ entityId: null, label: 'Ghost', descriptor: 'rival' }))).toEqual([]);
      expect(harvest(prose({ label: 'Ghost' }))).toEqual([]);
    });

    it('reads an image at an Asset URL as a decor asset edge, and an external image as none', () => {
      // A prose image is a capability-URL reference — decor by construction (ADR-0069).
      const hash = 'a'.repeat(64);
      const value = tiptapContent({
        type: 'doc',
        content: [
          { type: 'image', attrs: { src: `/assets/world-1/${hash}.png` } },
          { type: 'image', attrs: { src: 'https://example.test/cat.png' } },
        ],
      });
      expect(harvest(value)).toEqual([
        { targetKind: 'asset', targetId: hash, targetContainerId: 'world-1', descriptor: null, decor: true },
      ]);
    });

    /**
     * The edge names the Container the *URL* names (ADR-0080), so a picture drawn from a shelf counts as
     * usage of the shelf's Asset — the bytes and their meaning cross the boundary together, or neither does.
     */
    it('reads an image at another Container’s Asset URL as an edge into that Container', () => {
      const hash = 'a'.repeat(64);
      const value = tiptapContent({
        type: 'doc',
        content: [{ type: 'image', attrs: { src: `/assets/shelf-9/${hash}.png` } }],
      });
      expect(harvest(value)).toEqual([
        { targetKind: 'asset', targetId: hash, targetContainerId: 'shelf-9', descriptor: null, decor: true },
      ]);
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
      expect(harvest(value)).toEqual([
        { targetKind: 'entity', targetId: 'e1', targetContainerId: null, descriptor: 'liege', decor: false },
      ]);
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

describe('richContentSchema', () => {
  it('round-trips an arbitrary snapshot untouched — the seam never inspects it', () => {
    // ADR-0019: RichContent is opaque behind the format tag; parse/serialize must round-trip it exactly.
    const snapshot = {
      type: 'doc',
      content: [{ type: 'weirdFutureBlock', attrs: { x: [1, 2, { y: true }] } }],
    };
    const envelope = { format: 'tiptap-v1' as const, snapshot };

    const parsed = richContentSchema.parse(envelope);

    expect(parsed).toEqual(envelope);
    expect(JSON.parse(JSON.stringify(parsed))).toEqual(envelope);
  });

  it('round-trips a tiptap-v2 snapshot untouched — dual-read across the format bump (ADR-0023)', () => {
    // v2 is additive over v1; a reader loads either losslessly with no transform.
    const envelope = {
      format: 'tiptap-v2' as const,
      snapshot: {
        type: 'doc',
        content: [{ type: 'entityLink', attrs: { entityId: 'e1' } }],
      },
    };

    expect(richContentSchema.parse(envelope)).toEqual(envelope);
  });

  it('round-trips a tiptap-v3 snapshot untouched — the Obsidian-import schema bump (ADR-0033)', () => {
    // v3 is additive over v2 (callout/image/table/taskList/highlight, entityLink display/heading).
    const envelope = {
      format: 'tiptap-v3' as const,
      snapshot: {
        type: 'doc',
        content: [{ type: 'callout', attrs: { type: 'note', title: 'Beware' }, content: [] }],
      },
    };

    expect(richContentSchema.parse(envelope)).toEqual(envelope);
  });

  it('stamps a fresh snapshot with the tiptap-v3 write format (ADR-0033)', () => {
    expect(tiptapContent({ type: 'doc', content: [] }).format).toBe('tiptap-v3');
  });

  it('mints an empty document at the tiptap-v3 write format', () => {
    expect(emptyRichContent()).toEqual({ format: 'tiptap-v3', snapshot: { type: 'doc', content: [] } });
  });

  it('rejects an envelope tagged with an unknown format', () => {
    expect(() => richContentSchema.parse({ format: 'markdown-v9', snapshot: {} })).toThrow();
  });
});
