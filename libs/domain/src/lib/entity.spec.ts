import { emptyHexMap } from './hex/hex-map';
import {
  contentSchema,
  createEntityRequestSchema,
  emptyEntityBody,
  entityBodySchema,
  renameEntityRequestSchema,
  saveEntityRequestSchema,
} from './entity';

const content = { format: 'tiptap-v1' as const, snapshot: { type: 'doc', content: [] } };

describe('contentSchema', () => {
  it('round-trips an arbitrary snapshot untouched — the domain never inspects it', () => {
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

  it('rejects a Content envelope tagged with an unknown format', () => {
    expect(() =>
      contentSchema.parse({ format: 'markdown-v9', snapshot: {} }),
    ).toThrow();
  });
});

describe('entityBodySchema', () => {
  it('accepts a note body — Content only, no typed payload', () => {
    const body = { type: 'note' as const, content };

    expect(entityBodySchema.parse(body)).toEqual(body);
  });

  it('accepts a hexmap body — Content plus the hex grid alongside it', () => {
    const body = { type: 'hexmap' as const, content, ...emptyHexMap() };

    const parsed = entityBodySchema.parse(body);

    expect(parsed.type).toBe('hexmap');
    expect(parsed).toMatchObject({ hexes: {}, regions: [], labels: [] });
  });

  it('rejects a hexmap body missing its hex grid', () => {
    expect(() =>
      entityBodySchema.parse({ type: 'hexmap', content }),
    ).toThrow();
  });

  it('rejects an unknown entity type', () => {
    expect(() =>
      entityBodySchema.parse({ type: 'spreadsheet', content }),
    ).toThrow();
  });
});

describe('emptyEntityBody', () => {
  it('mints a note body with an empty Content envelope and no payload', () => {
    const body = emptyEntityBody('note');

    expect(entityBodySchema.parse(body)).toEqual(body);
    expect(body).toEqual({
      type: 'note',
      content: { format: 'tiptap-v1', snapshot: { type: 'doc', content: [] } },
    });
  });

  it('mints a hexmap body with an empty Content envelope and an empty grid', () => {
    const body = emptyEntityBody('hexmap');

    expect(entityBodySchema.parse(body)).toEqual(body);
    expect(body).toMatchObject({ type: 'hexmap', hexes: {}, regions: [], labels: [] });
  });
});

describe('createEntityRequestSchema', () => {
  it('accepts a request that names and types the entity', () => {
    const parsed = createEntityRequestSchema.parse({
      name: 'The Reach of Aldermoor',
      type: 'hexmap',
    });

    expect(parsed.name).toBe('The Reach of Aldermoor');
    expect(parsed.type).toBe('hexmap');
  });

  it('defaults tags to empty when none are given', () => {
    expect(
      createEntityRequestSchema.parse({ name: 'Aldermoor', type: 'note' }).tags,
    ).toEqual([]);
  });

  it('de-duplicates tags so a tag set is never persisted with repeats', () => {
    expect(
      createEntityRequestSchema.parse({
        name: 'Aldermoor',
        type: 'note',
        tags: ['kingdom', 'kingdom', 'coast'],
      }).tags,
    ).toEqual(['kingdom', 'coast']);
  });

  it('trims the name and rejects an empty or whitespace-only one', () => {
    // Reuses the same trimmed, non-empty rule the Hex Map title used (#12/#15).
    expect(
      createEntityRequestSchema.parse({ name: '  Aldermoor  ', type: 'note' })
        .name,
    ).toBe('Aldermoor');
    expect(() =>
      createEntityRequestSchema.parse({ name: '   ', type: 'note' }),
    ).toThrow();
  });

  it('rejects an unknown entity type', () => {
    expect(() =>
      createEntityRequestSchema.parse({ name: 'x', type: 'spreadsheet' }),
    ).toThrow();
  });
});

describe('renameEntityRequestSchema', () => {
  it('accepts a new, non-empty name and rejects an empty one', () => {
    // Metadata-only (no body, no base version) — never races with the save's optimistic-concurrency check.
    expect(renameEntityRequestSchema.parse({ name: 'Aldermoor' }).name).toBe(
      'Aldermoor',
    );
    expect(() => renameEntityRequestSchema.parse({ name: '   ' })).toThrow();
  });
});

describe('saveEntityRequestSchema', () => {
  it('carries the whole body, the base version, and the tags the save replaces', () => {
    const body = { type: 'hexmap' as const, content, ...emptyHexMap() };

    expect(
      saveEntityRequestSchema.parse({ document: body, version: 3, tags: [] }),
    ).toEqual({ document: body, version: 3, tags: [] });
  });

  it('requires tags on save — the save always carries the full current set', () => {
    const body = { type: 'note' as const, content };

    expect(() =>
      saveEntityRequestSchema.parse({ document: body, version: 3 }),
    ).toThrow();
  });

  it('normalizes tags on save: trims, lower-cases, dedupes, rejects blanks (#88)', () => {
    const body = { type: 'note' as const, content };

    expect(
      saveEntityRequestSchema.parse({
        document: body,
        version: 1,
        tags: [' Deity ', 'deity', 'RUINED'],
      }).tags,
    ).toEqual(['deity', 'ruined']);
    expect(() =>
      saveEntityRequestSchema.parse({ document: body, version: 1, tags: ['  '] }),
    ).toThrow();
  });

  it('rejects a save that omits the base version', () => {
    const body = { type: 'note' as const, content };

    expect(() => saveEntityRequestSchema.parse({ document: body })).toThrow();
  });

  it('rejects a save whose body fails the Entity schema', () => {
    expect(() =>
      saveEntityRequestSchema.parse({
        document: { type: 'hexmap', content },
        version: 1,
      }),
    ).toThrow();
  });
});
