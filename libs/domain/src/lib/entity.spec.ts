import { emptyHexMap } from './hex/hex-map';
import {
  contentSchema,
  CORE_HEXMAP,
  CORE_NOTE,
  createEntityRequestSchema,
  emptyEntityBody,
  entityBodySchema,
  entityListQuerySchema,
  hasHexGrid,
  patchEntityRequestSchema,
  saveEntityRequestSchema,
  tiptapContent,
  visibilitySchema,
  withPayloadsFor,
} from './entity';

const content = {
  format: 'tiptap-v1' as const,
  snapshot: { type: 'doc', content: [] },
};

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

  it('round-trips a tiptap-v2 snapshot untouched — dual-read across the format bump (ADR-0023)', () => {
    // v2 is additive over v1; a reader loads either losslessly with no transform.
    const envelope = {
      format: 'tiptap-v2' as const,
      snapshot: {
        type: 'doc',
        content: [{ type: 'entityLink', attrs: { entityId: 'e1' } }],
      },
    };

    const parsed = contentSchema.parse(envelope);

    expect(parsed).toEqual(envelope);
  });

  it('round-trips a tiptap-v3 snapshot untouched — the Obsidian-import schema bump (ADR-0033)', () => {
    // v3 is additive over v2 (callout/image/table/taskList/highlight, entityLink display/heading).
    const envelope = {
      format: 'tiptap-v3' as const,
      snapshot: {
        type: 'doc',
        content: [
          {
            type: 'callout',
            attrs: { type: 'note', title: 'Beware' },
            content: [],
          },
        ],
      },
    };

    expect(contentSchema.parse(envelope)).toEqual(envelope);
  });

  it('stamps new Content with the tiptap-v3 write format (ADR-0033)', () => {
    expect(tiptapContent({ type: 'doc', content: [] }).format).toBe('tiptap-v3');
  });

  it('rejects a Content envelope tagged with an unknown format', () => {
    expect(() => contentSchema.parse({ format: 'markdown-v9', snapshot: {} })).toThrow();
  });
});

describe('entityBodySchema', () => {
  it('accepts a rich-content body — Content only, the base every Entity carries', () => {
    const body = { content };

    expect(entityBodySchema.parse(body)).toEqual(body);
  });

  it('accepts a body carrying the hex-grid payload alongside its Content', () => {
    const body = { content, ...emptyHexMap() };

    const parsed = entityBodySchema.parse(body);

    expect(hasHexGrid(parsed)).toBe(true);
    expect(parsed).toMatchObject({ hexes: {}, regions: [], labels: [] });
  });

  it('reads a body with no grid fields as rich-content, not hex-grid', () => {
    // Discrimination is by payload composition (ADR-0048): no grid → the base kind, not a hex map.
    expect(hasHexGrid(entityBodySchema.parse({ content }))).toBe(false);
  });

  it('rejects a body missing its Content — every payload composes over the rich-content base', () => {
    expect(() => entityBodySchema.parse({ metadata: { note: 'orphan' } })).toThrow();
  });

  it('rejects a body whose hex-grid payload is malformed rather than stripping it to rich-content', () => {
    // A grid that fails the hex-grid shape must be a hard error, not a silent downgrade to a note:
    // the base branch is strict, so the stray `hexes` key can't fall through and be dropped.
    expect(() =>
      entityBodySchema.parse({
        content,
        hexes: 'not-a-record',
        regions: [],
        labels: [],
      }),
    ).toThrow();
  });
});

describe('emptyEntityBody', () => {
  it('mints a rich-content body with an empty Content envelope and no payload', () => {
    const body = emptyEntityBody([CORE_NOTE]);

    expect(entityBodySchema.parse(body)).toEqual(body);
    expect(body).toEqual({
      content: { format: 'tiptap-v3', snapshot: { type: 'doc', content: [] } },
    });
  });

  it('mints a hex-grid body when a type in the set adds the hex-grid payload', () => {
    const body = emptyEntityBody([CORE_HEXMAP]);

    expect(entityBodySchema.parse(body)).toEqual(body);
    expect(hasHexGrid(body)).toBe(true);
    expect(body).toMatchObject({ hexes: {}, regions: [], labels: [] });
  });
});

describe('withPayloadsFor (#189)', () => {
  const note = emptyEntityBody([CORE_NOTE]);

  it('adds the hex-grid payload when core.hexmap is added to a payload-less body', () => {
    const reconciled = withPayloadsFor(note, [CORE_NOTE, CORE_HEXMAP]);

    expect(hasHexGrid(reconciled)).toBe(true);
    expect(entityBodySchema.parse(reconciled)).toEqual(reconciled);
    // The base Content is preserved; only the grid payload is layered on.
    expect(reconciled.content).toBe(note.content);
  });

  it('returns the same body reference when the grid payload is already present', () => {
    const map = emptyEntityBody([CORE_HEXMAP]);
    expect(withPayloadsFor(map, [CORE_HEXMAP])).toBe(map);
  });

  it('leaves a body untouched when no type requires a payload', () => {
    expect(withPayloadsFor(note, [CORE_NOTE])).toBe(note);
  });

  it('never strips the grid when core.hexmap is dropped — the data outlives the lens', () => {
    const map = emptyEntityBody([CORE_HEXMAP]);
    const kept = withPayloadsFor(map, [CORE_NOTE]);
    expect(kept).toBe(map);
    expect(hasHexGrid(kept)).toBe(true);
  });
});

describe('entityListQuerySchema Facet params (#155)', () => {
  it('normalizes a single Facet value to an array (a lone query param arrives as a string)', () => {
    const parsed = entityListQuerySchema.parse({
      type: 'core.note',
      tag: 'deity',
      visibility: 'shared',
    });
    expect(parsed.type).toEqual(['core.note']);
    expect(parsed.tag).toEqual(['deity']);
    expect(parsed.visibility).toEqual(['shared']);
  });

  it('keeps repeated Facet values as an array (OR within a category)', () => {
    const parsed = entityListQuerySchema.parse({
      type: ['core.note', 'core.hexmap'],
      tag: ['deity', 'ruined'],
    });
    expect(parsed.type).toEqual(['core.note', 'core.hexmap']);
    expect(parsed.tag).toEqual(['deity', 'ruined']);
  });

  it('rejects a malformed type or visibility value at the boundary (ADR-0001)', () => {
    // The type set is open, but a filter value must still be a `namespace.id` key, not bare flavour.
    expect(() => entityListQuerySchema.parse({ type: 'spreadsheet' })).toThrow();
    expect(() => entityListQuerySchema.parse({ visibility: 'public' })).toThrow();
  });

  it('leaves Facet params undefined when absent', () => {
    const parsed = entityListQuerySchema.parse({});
    expect(parsed.type).toBeUndefined();
    expect(parsed.tag).toBeUndefined();
    expect(parsed.visibility).toBeUndefined();
  });
});

describe('createEntityRequestSchema', () => {
  it('accepts a request that names and types the entity', () => {
    const parsed = createEntityRequestSchema.parse({
      name: 'The Reach of Aldermoor',
      types: ['core.hexmap'],
    });

    expect(parsed.name).toBe('The Reach of Aldermoor');
    expect(parsed.types).toEqual(['core.hexmap']);
  });

  it('de-duplicates the ordered type set, keeping the primary first', () => {
    expect(
      createEntityRequestSchema.parse({
        name: 'Aldermoor',
        types: ['core.hexmap', 'core.note', 'core.hexmap'],
      }).types,
    ).toEqual(['core.hexmap', 'core.note']);
  });

  it('rejects a create with no types — every Entity has a primary type', () => {
    expect(() => createEntityRequestSchema.parse({ name: 'x', types: [] })).toThrow();
  });

  it('defaults tags to empty when none are given', () => {
    expect(
      createEntityRequestSchema.parse({
        name: 'Aldermoor',
        types: ['core.note'],
      }).tags,
    ).toEqual([]);
  });

  it('de-duplicates tags so a tag set is never persisted with repeats', () => {
    expect(
      createEntityRequestSchema.parse({
        name: 'Aldermoor',
        types: ['core.note'],
        tags: ['kingdom', 'kingdom', 'coast'],
      }).tags,
    ).toEqual(['kingdom', 'coast']);
  });

  it('trims the name and rejects an empty or whitespace-only one', () => {
    // Reuses the same trimmed, non-empty rule the Hex Map title used (#12/#15).
    expect(
      createEntityRequestSchema.parse({
        name: '  Aldermoor  ',
        types: ['core.note'],
      }).name,
    ).toBe('Aldermoor');
    expect(() => createEntityRequestSchema.parse({ name: '   ', types: ['core.note'] })).toThrow();
  });

  it('rejects a malformed type id — a type is a `namespace.id` key, not bare flavour', () => {
    expect(() => createEntityRequestSchema.parse({ name: 'x', types: ['spreadsheet'] })).toThrow();
  });

  it('accepts an optional worldId, and omits it when absent (server defaults to the owner World)', () => {
    // A client may target a specific World; when omitted the server resolves the owner's World (#101).
    expect(
      createEntityRequestSchema.parse({
        name: 'x',
        types: ['core.note'],
        worldId: 'w1',
      }).worldId,
    ).toBe('w1');
    expect(createEntityRequestSchema.parse({ name: 'x', types: ['core.note'] }).worldId).toBeUndefined();
  });

  it('carries an optional initial Metadata map for a picked type’s required Fields (#189)', () => {
    const parsed = createEntityRequestSchema.parse({
      name: 'Balthazar',
      types: ['dnd.monster'],
      metadata: { cr: 5 },
    });
    expect(parsed.metadata).toEqual({ cr: 5 });
    // Omitted metadata parses to undefined (a blank map, minted server-side).
    expect(createEntityRequestSchema.parse({ name: 'x', types: ['core.note'] }).metadata).toBeUndefined();
  });
});

describe('visibilitySchema', () => {
  it('accepts the two Entity Visibility values and rejects the retired "public" (ADR-0024)', () => {
    // Sharing is per-World now: an Entity is `private` (owner-only) or `shared` (all World members).
    expect(visibilitySchema.parse('private')).toBe('private');
    expect(visibilitySchema.parse('shared')).toBe('shared');
    expect(() => visibilitySchema.parse('public')).toThrow();
  });
});

describe('patchEntityRequestSchema', () => {
  it('accepts a name change or a visibility change — and rejects an empty patch', () => {
    // Metadata-only (no body, no base version) — never races with the save's optimistic-concurrency check.
    expect(patchEntityRequestSchema.parse({ name: 'Aldermoor' }).name).toBe('Aldermoor');
    expect(patchEntityRequestSchema.parse({ visibility: 'shared' }).visibility).toBe('shared');
    expect(() => patchEntityRequestSchema.parse({ name: '   ' })).toThrow();
    // Exactly one field must change — an empty body is a no-op, not a valid patch.
    expect(() => patchEntityRequestSchema.parse({})).toThrow();
  });

  /**
   * A rename is substance (an entity-level Editor may make it); a Visibility flip is exposure
   * (full write rights). They are different write kinds with different gates, so one request
   * cannot carry both without making the caller choose the rule that judges it (ADR-0045).
   */
  it('rejects a patch carrying both name and visibility — they are different write kinds', () => {
    expect(() =>
      patchEntityRequestSchema.parse({
        name: 'Aldermoor',
        visibility: 'shared',
      }),
    ).toThrow();
  });
});

describe('saveEntityRequestSchema', () => {
  it('carries the whole body, the base version, and the tags the save replaces', () => {
    const body = { content, ...emptyHexMap() };

    expect(saveEntityRequestSchema.parse({ document: body, version: 3, tags: [] })).toEqual({
      document: body,
      version: 3,
      tags: [],
    });
  });

  it('accepts an optional type set the save replaces, and omits it when absent', () => {
    const body = { content };

    expect(
      saveEntityRequestSchema.parse({
        document: body,
        version: 1,
        tags: [],
        types: ['core.note'],
      }).types,
    ).toEqual(['core.note']);
    expect(saveEntityRequestSchema.parse({ document: body, version: 1, tags: [] })).not.toHaveProperty('types');
  });

  it('ignores a descriptors field a stale client still sends (server harvests them now, #96)', () => {
    const body = { content };

    // The wire no longer carries descriptors — the server derives them from the
    // saved Content — so an old client's field is a stripped unknown key.
    const parsed = saveEntityRequestSchema.parse({
      document: body,
      version: 1,
      tags: [],
      descriptors: ['spouse'],
    });
    expect(parsed).not.toHaveProperty('descriptors');
  });

  it('requires tags on save — the save always carries the full current set', () => {
    const body = { content };

    expect(() => saveEntityRequestSchema.parse({ document: body, version: 3 })).toThrow();
  });

  it('normalizes tags on save: trims, lower-cases, dedupes, rejects blanks (#88)', () => {
    const body = { content };

    expect(
      saveEntityRequestSchema.parse({
        document: body,
        version: 1,
        tags: [' Deity ', 'deity', 'RUINED'],
      }).tags,
    ).toEqual(['deity', 'ruined']);
    expect(() =>
      saveEntityRequestSchema.parse({
        document: body,
        version: 1,
        tags: ['  '],
      }),
    ).toThrow();
  });

  it('rejects a save that omits the base version', () => {
    const body = { content };

    expect(() => saveEntityRequestSchema.parse({ document: body })).toThrow();
  });

  it('rejects a save whose body fails the Entity schema', () => {
    expect(() =>
      saveEntityRequestSchema.parse({
        document: { metadata: { orphan: true } },
        version: 1,
      }),
    ).toThrow();
  });
});
