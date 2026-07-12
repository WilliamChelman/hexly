import {
  contentSchema,
  createEntityRequestSchema,
  entityBodySchema,
  entityListQuerySchema,
  patchEntityRequestSchema,
  saveEntityRequestSchema,
  tiptapContent,
  visibilitySchema,
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
  it('accepts the one body shape — Content and Metadata, for every Entity (ADR-0050)', () => {
    const body = { content, metadata: { alignment: 'lawful-good' } };

    expect(entityBodySchema.parse(body)).toEqual(body);
  });

  it('accepts a body with no Metadata at all', () => {
    expect(entityBodySchema.parse({ content })).toEqual({ content });
  });

  it("carries a plugin's Structured Field value as Metadata like any other Field's (ADR-0050)", () => {
    // The collapse: nothing about a structured value is special to the body schema — it is a value at
    // a Metadata key, so the body needs no union and no registry to parse it.
    const body = { content, metadata: { grid: { tiles: {}, zones: [] } } };

    expect(entityBodySchema.parse(body)).toEqual(body);
  });

  it('tolerates a malformed structured value at rest — a Metadata value is never type-checked here', () => {
    // Forward-only (CONTEXT.md → Field): garbage at `grid` parses, so a corrupt document opens (as an
    // empty value) rather than 500ing on read. The first edit overwrites it.
    const body = { content, metadata: { grid: 'not-a-grid' } };

    expect(entityBodySchema.parse(body)).toEqual(body);
  });

  it('rejects a body missing its Content', () => {
    expect(() => entityBodySchema.parse({ metadata: { note: 'orphan' } })).toThrow();
  });

  it("rejects a pre-collapse body carrying a plugin's value at the root, rather than reading it as a note", () => {
    // The body root is closed (`.strict()`): an unknown key there is a document this build cannot
    // represent, and silently dropping it would read such a body as a note that has lost its substance.
    expect(() => entityBodySchema.parse({ content, tiles: {}, zones: [] })).toThrow();
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
      type: ['core.note', 'dnd.monster'],
      tag: ['deity', 'ruined'],
    });
    expect(parsed.type).toEqual(['core.note', 'dnd.monster']);
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
      types: ['dnd.monster'],
    });

    expect(parsed.name).toBe('The Reach of Aldermoor');
    expect(parsed.types).toEqual(['dnd.monster']);
  });

  it('de-duplicates the ordered type set, keeping the primary first', () => {
    expect(
      createEntityRequestSchema.parse({
        name: 'Aldermoor',
        types: ['dnd.monster', 'core.note', 'dnd.monster'],
      }).types,
    ).toEqual(['dnd.monster', 'core.note']);
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
    // Reuses the same trimmed, non-empty rule the map title used (#12/#15).
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
    const body = { content, metadata: { armor_class: 15 } };

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
