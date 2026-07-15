import {
  createEntityRequestSchema,
  entityDocumentSchema,
  entityListQuerySchema,
  patchEntityRequestSchema,
  saveEntityRequestSchema,
  visibilitySchema,
} from './entity';

/** The body is the EntityDocument map itself (ADR-0051): an open record the schema interprets no key of. */
const body = { alignment: 'lawful-good', armor_class: 15 };

describe('entityDocumentSchema (the body is the EntityDocument map, ADR-0051)', () => {
  it('accepts any record of keys — the body root interprets none of them', () => {
    // A prose value, a grid, a scalar Field all sit at their own key with no wrapper and no union.
    const body = { alignment: 'lawful-good', grid: { hexes: {}, regions: [] } };

    expect(entityDocumentSchema.parse(body)).toEqual(body);
  });

  it('accepts the empty map — a bodyless placeholder a load clears the canvas to', () => {
    expect(entityDocumentSchema.parse({})).toEqual({});
  });

  it('tolerates a malformed structured value at rest — a body value is never type-checked here', () => {
    // Forward-only (CONTEXT.md → Field): garbage at a key parses, so a corrupt document opens (as an
    // empty value) rather than 500ing on read. The first edit overwrites it.
    const body = { grid: 'not-a-grid' };

    expect(entityDocumentSchema.parse(body)).toEqual(body);
  });

  it('rejects a non-object body — the document column always holds a map', () => {
    expect(() => entityDocumentSchema.parse('a string')).toThrow();
    expect(() => entityDocumentSchema.parse([1, 2])).toThrow();
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

  it('accepts directly-attached Field ids (fields[], ADR-0054), deduping and defaulting to empty', () => {
    expect(
      createEntityRequestSchema.parse({
        name: 'Sol',
        types: ['world.deity'],
        fields: ['world.element', 'world.element', 'world.domain'],
      }).fields,
    ).toEqual(['world.element', 'world.domain']);
    // Omitted → an Entity attaching no Field of its own (its effective set is its types' defaults).
    expect(createEntityRequestSchema.parse({ name: 'x', types: ['core.note'] }).fields).toEqual([]);
  });

  it('rejects an attached Field id that is not a `namespace.id` key', () => {
    expect(createEntityRequestSchema.safeParse({ name: 'x', types: ['core.note'], fields: ['element'] }).success).toBe(
      false,
    );
  });

  it('carries an optional initial EntityDocument map for a picked type’s required Fields (#189)', () => {
    const parsed = createEntityRequestSchema.parse({
      name: 'Balthazar',
      types: ['dnd.monster'],
      document: { cr: 5 },
    });
    expect(parsed.document).toEqual({ cr: 5 });
    // Omitted document parses to undefined (a blank map, minted server-side).
    expect(createEntityRequestSchema.parse({ name: 'x', types: ['core.note'] }).document).toBeUndefined();
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
    // EntityDocument-only (no body, no base version) — never races with the save's optimistic-concurrency check.
    expect(patchEntityRequestSchema.parse({ name: 'Aldermoor' }).name).toBe('Aldermoor');
    expect(patchEntityRequestSchema.parse({ visibility: 'shared' }).visibility).toBe('shared');
    expect(() => patchEntityRequestSchema.parse({ name: '   ' })).toThrow();
    // Exactly one field must change — an empty body is a no-op, not a valid patch.
    expect(() => patchEntityRequestSchema.parse({})).toThrow();
  });

  /**
   * A rename is substance (an entity-level Editor may make it); a Visibility flip is exposure
   * (full write rights). Different gates, so one request cannot carry both (ADR-0045).
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
    expect(saveEntityRequestSchema.parse({ document: body, version: 3, tags: [] })).toEqual({
      document: body,
      version: 3,
      tags: [],
    });
  });

  it('accepts an optional type set the save replaces, and omits it when absent', () => {
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

  it('accepts an optional attached-Field id set the save replaces, and omits it when absent (ADR-0054)', () => {
    expect(
      saveEntityRequestSchema.parse({
        document: body,
        version: 1,
        tags: [],
        fields: ['world.element', 'world.element'],
      }).fields,
    ).toEqual(['world.element']);
    expect(saveEntityRequestSchema.parse({ document: body, version: 1, tags: [] })).not.toHaveProperty('fields');
  });

  it('ignores a descriptors field a stale client still sends (server harvests them now, #96)', () => {
    // The wire no longer carries descriptors — the server derives them from the
    // saved document — so an old client's field is a stripped unknown key.
    const parsed = saveEntityRequestSchema.parse({
      document: body,
      version: 1,
      tags: [],
      descriptors: ['spouse'],
    });
    expect(parsed).not.toHaveProperty('descriptors');
  });

  it('requires tags on save — the save always carries the full current set', () => {
    expect(() => saveEntityRequestSchema.parse({ document: body, version: 3 })).toThrow();
  });

  it('normalizes tags on save: trims, lower-cases, dedupes, rejects blanks (#88)', () => {
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
    expect(() => saveEntityRequestSchema.parse({ document: body })).toThrow();
  });

  it('rejects a save whose body is not a map — the document column always holds a record', () => {
    expect(() =>
      saveEntityRequestSchema.parse({
        document: 'not a map',
        version: 1,
      }),
    ).toThrow();
  });
});
