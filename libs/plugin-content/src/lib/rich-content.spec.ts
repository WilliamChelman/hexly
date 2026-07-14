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

  describe('vault projection — the body converters (ADR-0051)', () => {
    const vault = RICH_CONTENT_DATA_TYPE.vault!;

    it('projects to the Markdown body', () => {
      expect(vault.slot).toBe('body');
    });

    it('toMarkdown refreshes a wikilink label to the target’s current name and repoints an asset src', () => {
      const value = tiptapContent({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'entityLink', attrs: { entityId: 'mara', label: 'Old Name' } }],
          },
          { type: 'image', attrs: { src: '/assets/w1/hash.png' } },
        ],
      });
      const md = vault.toMarkdown!(value, {
        entityName: (id) => (id === 'mara' ? 'Lady Mara' : undefined),
        assetPath: (url) => (url === '/assets/w1/hash.png' ? 'assets/portrait.png' : undefined),
      });
      expect(md).toContain('[[Lady Mara]]');
      expect(md).toContain('assets/portrait.png');
    });

    it('toMarkdown never mutates the stored snapshot', () => {
      const value = tiptapContent({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'entityLink', attrs: { entityId: 'mara', label: 'Old' } }] }],
      });
      vault.toMarkdown!(value, { entityName: () => 'New', assetPath: () => undefined });
      const link = (value.snapshot as { content: { content: { attrs: { label: string } }[] }[] }).content[0].content[0];
      expect(link.attrs.label).toBe('Old');
    });

    it('toMarkdown serializes an unreadable value as an empty document, not a throw', () => {
      expect(vault.toMarkdown!('garbage', { entityName: () => undefined, assetPath: () => undefined })).toBe('');
    });

    it('fromMarkdown resolves a wikilink to an entityId, stores an asset, and reports degraded constructs', () => {
      const degraded: Record<string, number> = {};
      const value = vault.fromMarkdown!('Guarded by [[Lady Mara]].[^1]\n\n[^1]: note\n\n![[portrait.png]]', {
        resolveLink: (label) => (label === 'Lady Mara' ? 'mara-id' : null),
        storeAsset: (src) => (src === 'portrait.png' ? '/assets/w1/hash.png' : null),
        degrade: (construct, n = 1) => (degraded[construct] = (degraded[construct] ?? 0) + n),
      }) as { snapshot: unknown };

      const links: Record<string, unknown>[] = [];
      const imgs: string[] = [];
      const walk = (node: { type?: string; attrs?: Record<string, unknown>; content?: unknown[] }) => {
        if (node.type === 'entityLink') links.push(node.attrs ?? {});
        if (node.type === 'image') imgs.push(String(node.attrs?.['src'] ?? ''));
        for (const c of node.content ?? []) walk(c as typeof node);
      };
      walk(value.snapshot as { content?: unknown[] });

      expect(links[0]['entityId']).toBe('mara-id');
      expect(imgs).toEqual(['/assets/w1/hash.png']);
      expect(degraded).toEqual({ footnote: 1 });
    });

    it('fromMarkdown leaves a same-note anchor unresolved and never calls the resolver for it', () => {
      let calls = 0;
      const value = vault.fromMarkdown!('Jump to [[#Defenses]].', {
        resolveLink: () => {
          calls++;
          return 'should-not-happen';
        },
        storeAsset: () => null,
        degrade: () => undefined,
      }) as { snapshot: { content: { content: { type: string; attrs: Record<string, unknown> }[] }[] } };
      expect(calls).toBe(0);
      const link = value.snapshot.content[0].content.find((n) => n.type === 'entityLink');
      expect(link?.attrs['entityId']).toBeNull();
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
