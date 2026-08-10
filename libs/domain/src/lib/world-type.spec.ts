import {
  createUserDefinedTypeRequestSchema,
  deriveWorldTypeId,
  slugifyTypeSegment,
  updateUserDefinedTypeRequestSchema,
  userDefinedTypeIdSchema,
  userDefinedTypeSchema,
} from './world-type';

describe('slugifyTypeSegment', () => {
  it('accent-folds, lowercases, and dash-collapses a raw label (ADR-0056)', () => {
    expect(slugifyTypeSegment('Déïty')).toBe('deity');
    expect(slugifyTypeSegment('  Hell Deity  ')).toBe('hell-deity');
    expect(slugifyTypeSegment('Elder God!!')).toBe('elder-god');
  });

  it('is idempotent — a re-slug of a slug is the same slug', () => {
    expect(slugifyTypeSegment(slugifyTypeSegment('Hell Deity'))).toBe('hell-deity');
  });
});

describe('deriveWorldTypeId', () => {
  it('derives a `world.type.<slug>` id from the label', () => {
    expect(deriveWorldTypeId('Deity')).toBe('world.type.deity');
    expect(deriveWorldTypeId('Hell Deity')).toBe('world.type.hell-deity');
  });

  it('disambiguates with a numeric suffix when the bare slug collides (immutable ids, #438)', () => {
    // "Deity" typed twice: the second mint can't reuse the first's frozen id, so it takes `-2`.
    expect(deriveWorldTypeId('Deity', ['world.type.deity'])).toBe('world.type.deity-2');
    // …and climbs past every taken suffix rather than stopping at the first miss.
    expect(deriveWorldTypeId('Deity', ['world.type.deity', 'world.type.deity-2'])).toBe('world.type.deity-3');
  });

  it('leaves the bare slug alone when nothing collides', () => {
    expect(deriveWorldTypeId('Deity', ['world.type.hero'])).toBe('world.type.deity');
  });
});

describe('userDefinedTypeIdSchema', () => {
  it('accepts a `world.`-namespaced id', () => {
    expect(userDefinedTypeIdSchema.parse('world.type.deity')).toBe('world.type.deity');
  });

  it('rejects a plugin/core namespace and a bare id', () => {
    expect(userDefinedTypeIdSchema.safeParse('dnd.type.monster').success).toBe(false);
    expect(userDefinedTypeIdSchema.safeParse('core.type.note').success).toBe(false);
    // A bare `world` (no kind/name segments) is not a valid `namespace.type.name` key at all.
    expect(userDefinedTypeIdSchema.safeParse('world').success).toBe(false);
  });
});

describe('userDefinedTypeSchema', () => {
  it('parses an id + label, defaulting an omitted fieldRefs to empty (ADR-0054)', () => {
    expect(userDefinedTypeSchema.parse({ id: 'world.type.faction', label: 'Faction' })).toEqual({
      id: 'world.type.faction',
      label: 'Faction',
      fieldRefs: [],
    });
  });

  it('references default Fields by id (fieldRefs), deduping and preserving order', () => {
    const parsed = userDefinedTypeSchema.parse({
      id: 'world.type.deity',
      label: 'Deity',
      fieldRefs: ['world.field.element', 'world.field.domain', 'world.field.element'],
    });
    expect(parsed.fieldRefs).toEqual(['world.field.element', 'world.field.domain']);
  });

  it('rejects a fieldRef that is not a `namespace.field.name` key', () => {
    expect(
      userDefinedTypeSchema.safeParse({ id: 'world.type.deity', label: 'Deity', fieldRefs: ['element'] }).success,
    ).toBe(false);
  });

  it('leaves `views` absent rather than empty when the author named no order (#201)', () => {
    // Absent is what the host defaults for — Fields, then Content, then the Structured Data Type Fields — so a
    // deity that grows a battlemap still opens on its Fields. An *empty* list would mean "no views".
    expect(userDefinedTypeSchema.parse({ id: 'world.type.faction', label: 'Faction' }).views).toBeUndefined();
  });

  it('carries an ordered `views` list placing a View id and one of its referenced Fields (#201)', () => {
    const parsed = userDefinedTypeSchema.parse({
      id: 'world.type.deity',
      label: 'Deity',
      fieldRefs: ['world.field.battle-map'],
      views: ['core.view.fields', 'core.view.rich-content', { field: 'battlemap' }],
    });
    expect(parsed.views).toEqual(['core.view.fields', 'core.view.rich-content', { field: 'battlemap' }]);
  });

  it('accepts a `{ field }` placement without cross-checking the key — resolution is best-effort (ADR-0054)', () => {
    // The type carries Field *ids* (`fieldRefs`), not the document *keys* a placement names, so the
    // domain cannot (and no longer does) reject an orphaned placement: it is inert at resolution.
    const parsed = userDefinedTypeSchema.parse({
      id: 'world.type.deity',
      label: 'Deity',
      views: [{ field: 'battlemap' }],
    });
    expect(parsed.views).toEqual([{ field: 'battlemap' }]);
  });

  it('rejects a View id that is not a `namespace.view.name` key', () => {
    const typo = userDefinedTypeSchema.safeParse({ id: 'world.type.deity', label: 'Deity', views: ['fields'] });
    expect(typo.success).toBe(false);
  });
});

describe('createUserDefinedTypeRequestSchema', () => {
  it('requires a `world.` id and a label', () => {
    expect(createUserDefinedTypeRequestSchema.safeParse({ label: 'Deity' }).success).toBe(false);
    expect(createUserDefinedTypeRequestSchema.safeParse({ id: 'x.type.deity', label: 'Deity' }).success).toBe(false);
    expect(
      createUserDefinedTypeRequestSchema.parse({
        id: 'world.type.deity',
        label: 'Deity',
        fieldRefs: ['world.field.domain'],
      }),
    ).toEqual({
      id: 'world.type.deity',
      label: 'Deity',
      fieldRefs: ['world.field.domain'],
    });
  });
});

describe('updateUserDefinedTypeRequestSchema', () => {
  it('accepts a lone label, fieldRefs, or views patch', () => {
    expect(updateUserDefinedTypeRequestSchema.parse({ label: 'Renamed' })).toEqual({ label: 'Renamed' });
    expect(updateUserDefinedTypeRequestSchema.parse({ fieldRefs: ['world.field.element'] })).toEqual({
      fieldRefs: ['world.field.element'],
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
      fieldRefs: ['world.field.battle-map'],
      views: ['core.view.fields', { field: 'battlemap' }],
    });
    expect(patch.views).toEqual(['core.view.fields', { field: 'battlemap' }]);
  });
});
