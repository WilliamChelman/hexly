import { contentSchema, emptyContent, tiptapContent } from './content';

describe('contentSchema', () => {
  it('round-trips an arbitrary snapshot untouched — the seam never inspects it', () => {
    // ADR-0019: Content is opaque behind the format tag; parse/serialize must round-trip it exactly.
    const snapshot = {
      type: 'doc',
      content: [{ type: 'weirdFutureBlock', attrs: { x: [1, 2, { y: true }] } }],
    };
    const envelope = { format: 'tiptap-v1' as const, snapshot };

    const parsed = contentSchema.parse(envelope);

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

    expect(contentSchema.parse(envelope)).toEqual(envelope);
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

    expect(contentSchema.parse(envelope)).toEqual(envelope);
  });

  it('stamps a fresh snapshot with the tiptap-v3 write format (ADR-0033)', () => {
    expect(tiptapContent({ type: 'doc', content: [] }).format).toBe('tiptap-v3');
  });

  it('mints an empty document at the tiptap-v3 write format', () => {
    expect(emptyContent()).toEqual({ format: 'tiptap-v3', snapshot: { type: 'doc', content: [] } });
  });

  it('rejects an envelope tagged with an unknown format', () => {
    expect(() => contentSchema.parse({ format: 'markdown-v9', snapshot: {} })).toThrow();
  });
});
