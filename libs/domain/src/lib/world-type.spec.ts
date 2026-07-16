import {
  createUserDefinedTypeRequestSchema,
  updateUserDefinedTypeRequestSchema,
  userDefinedTypeIdSchema,
  userDefinedTypeSchema,
} from './world-type';

describe('userDefinedTypeIdSchema', () => {
  it('accepts a `world.`-namespaced id', () => {
    expect(userDefinedTypeIdSchema.parse('world.deity')).toBe('world.deity');
  });

  it('rejects a plugin/core namespace and a bare id', () => {
    expect(userDefinedTypeIdSchema.safeParse('dnd.monster').success).toBe(false);
    expect(userDefinedTypeIdSchema.safeParse('core.note').success).toBe(false);
    // A bare `world` (no `.id`) is not a valid `namespace.id` key at all.
    expect(userDefinedTypeIdSchema.safeParse('world').success).toBe(false);
  });
});

describe('userDefinedTypeSchema', () => {
  it('parses an id + label, defaulting an omitted fieldRefs to empty (ADR-0054)', () => {
    expect(userDefinedTypeSchema.parse({ id: 'world.faction', label: 'Faction' })).toEqual({
      id: 'world.faction',
      label: 'Faction',
      fieldRefs: [],
    });
  });

  it('references default Fields by id (fieldRefs), deduping and preserving order', () => {
    const parsed = userDefinedTypeSchema.parse({
      id: 'world.deity',
      label: 'Deity',
      fieldRefs: ['world.element', 'world.domain', 'world.element'],
    });
    expect(parsed.fieldRefs).toEqual(['world.element', 'world.domain']);
  });

  it('rejects a fieldRef that is not a `namespace.id` key', () => {
    expect(userDefinedTypeSchema.safeParse({ id: 'world.deity', label: 'Deity', fieldRefs: ['element'] }).success).toBe(
      false,
    );
  });

  it('leaves `views` absent rather than empty when the author named no order (#201)', () => {
    // Absent is what the host defaults for — Fields, then Content, then the Structured Data Type Fields — so a
    // deity that grows a battlemap still opens on its Fields. An *empty* list would mean "no views".
    expect(userDefinedTypeSchema.parse({ id: 'world.faction', label: 'Faction' }).views).toBeUndefined();
  });

  it('carries an ordered `views` list placing a View id and one of its referenced Fields (#201)', () => {
    const parsed = userDefinedTypeSchema.parse({
      id: 'world.deity',
      label: 'Deity',
      fieldRefs: ['world.battlemap'],
      views: ['core.view.fields', 'core.view.content', { field: 'battlemap' }],
    });
    expect(parsed.views).toEqual(['core.view.fields', 'core.view.content', { field: 'battlemap' }]);
  });

  it('accepts a `{ field }` placement without cross-checking the key — resolution is best-effort (ADR-0054)', () => {
    // The type carries Field *ids* (`fieldRefs`), not the document *keys* a placement names, so the
    // domain cannot (and no longer does) reject an orphaned placement: it is inert at resolution.
    const parsed = userDefinedTypeSchema.parse({
      id: 'world.deity',
      label: 'Deity',
      views: [{ field: 'battlemap' }],
    });
    expect(parsed.views).toEqual([{ field: 'battlemap' }]);
  });

  it('rejects a View id that is not a `namespace.id` key', () => {
    const typo = userDefinedTypeSchema.safeParse({ id: 'world.deity', label: 'Deity', views: ['fields'] });
    expect(typo.success).toBe(false);
  });
});

describe('createUserDefinedTypeRequestSchema', () => {
  it('requires a `world.` id and a label', () => {
    expect(createUserDefinedTypeRequestSchema.safeParse({ label: 'Deity' }).success).toBe(false);
    expect(createUserDefinedTypeRequestSchema.safeParse({ id: 'x.deity', label: 'Deity' }).success).toBe(false);
    expect(
      createUserDefinedTypeRequestSchema.parse({ id: 'world.deity', label: 'Deity', fieldRefs: ['world.domain'] }),
    ).toEqual({
      id: 'world.deity',
      label: 'Deity',
      fieldRefs: ['world.domain'],
    });
  });
});

describe('updateUserDefinedTypeRequestSchema', () => {
  it('accepts a lone label, fieldRefs, or views patch', () => {
    expect(updateUserDefinedTypeRequestSchema.parse({ label: 'Renamed' })).toEqual({ label: 'Renamed' });
    expect(updateUserDefinedTypeRequestSchema.parse({ fieldRefs: ['world.element'] })).toEqual({
      fieldRefs: ['world.element'],
    });
    expect(updateUserDefinedTypeRequestSchema.parse({ views: ['core.view.fields'] })).toEqual({
      views: ['core.view.fields'],
    });
  });

  it('rejects an empty patch that changes nothing', () => {
    expect(updateUserDefinedTypeRequestSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a fieldRefs + views patch placing a referenced Structured Data Type Field (#201)', () => {
    const patch = updateUserDefinedTypeRequestSchema.parse({
      fieldRefs: ['world.battlemap'],
      views: ['core.view.fields', { field: 'battlemap' }],
    });
    expect(patch.views).toEqual(['core.view.fields', { field: 'battlemap' }]);
  });
});
