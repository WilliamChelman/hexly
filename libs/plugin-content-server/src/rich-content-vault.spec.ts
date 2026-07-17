import { tiptapContent, RICH_CONTENT_DATA_TYPE } from '@hexly/plugin-content';
import { RICH_CONTENT_DATA_TYPE_VAULT } from './rich-content-vault';

describe('vault projection — the body converters (ADR-0051)', () => {
  // The converters live on the vault variant (the API's registration); the converter-free web variant
  // carries only the `body` slot, so the initial web bundle skips the ~160 kB Markdown toolchain.
  const vault = RICH_CONTENT_DATA_TYPE_VAULT.vault!;

  it('projects to the Markdown body', () => {
    expect(vault.slot).toBe('body');
  });

  it('the web variant declares the body slot but carries no converter — the toolchain stays server-side', () => {
    expect(RICH_CONTENT_DATA_TYPE.vault?.slot).toBe('body');
    expect(RICH_CONTENT_DATA_TYPE.vault?.toMarkdown).toBeUndefined();
    expect(RICH_CONTENT_DATA_TYPE.vault?.fromMarkdown).toBeUndefined();
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
