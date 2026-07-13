import {
  createUserDefinedTypeRequestSchema,
  updateUserDefinedTypeRequestSchema,
  userDefinedTypeIdSchema,
  userDefinedTypeSchema,
} from './world-type';

const domainField = { key: 'domain', label: 'Domain', dataType: { kind: 'string' as const } };
const alignmentField = { key: 'alignment', label: 'Alignment', dataType: { kind: 'string' as const } };
/** An invented kind, as everywhere in the domain's specs — no plugin's id belongs here. */
const battlemapField = { key: 'battlemap', label: 'Battlemap', dataType: { kind: 'test.board' as const } };

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
  it('parses an id + label + fields, defaulting an omitted fields to empty', () => {
    expect(userDefinedTypeSchema.parse({ id: 'world.faction', label: 'Faction' })).toEqual({
      id: 'world.faction',
      label: 'Faction',
      fields: [],
    });
  });

  it('carries a facetable Field through unchanged', () => {
    const parsed = userDefinedTypeSchema.parse({
      id: 'world.deity',
      label: 'Deity',
      fields: [{ ...domainField, facetable: true }],
    });
    expect(parsed.fields).toEqual([{ ...domainField, required: false, facetable: true }]);
  });

  it('rejects two Fields typing the same Metadata key', () => {
    const dup = userDefinedTypeSchema.safeParse({
      id: 'world.deity',
      label: 'Deity',
      fields: [domainField, { ...domainField, label: 'Other' }],
    });
    expect(dup.success).toBe(false);
  });

  it('leaves `views` absent rather than empty when the author named no order (#201)', () => {
    // Absent is what the host defaults for — Fields, then Content, then the Structured Fields — so a
    // deity that grows a battlemap still opens on its Fields. An *empty* list would mean "no views".
    expect(userDefinedTypeSchema.parse({ id: 'world.faction', label: 'Faction' }).views).toBeUndefined();
  });

  it('carries an ordered `views` list placing a View id and one of its own Fields (#201)', () => {
    const parsed = userDefinedTypeSchema.parse({
      id: 'world.deity',
      label: 'Deity',
      fields: [battlemapField],
      views: ['core.view.fields', 'core.view.content', { field: 'battlemap' }],
    });
    expect(parsed.views).toEqual(['core.view.fields', 'core.view.content', { field: 'battlemap' }]);
  });

  it('rejects a View placement naming a Field the type does not declare', () => {
    const orphan = userDefinedTypeSchema.safeParse({
      id: 'world.deity',
      label: 'Deity',
      fields: [domainField],
      views: [{ field: 'battlemap' }],
    });
    expect(orphan.success).toBe(false);
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
      createUserDefinedTypeRequestSchema.parse({ id: 'world.deity', label: 'Deity', fields: [domainField] }),
    ).toEqual({ id: 'world.deity', label: 'Deity', fields: [{ ...domainField, required: false, facetable: false }] });
  });
});

describe('updateUserDefinedTypeRequestSchema', () => {
  it('accepts a lone label or a lone fields patch', () => {
    expect(updateUserDefinedTypeRequestSchema.parse({ label: 'Renamed' })).toEqual({ label: 'Renamed' });
    expect(updateUserDefinedTypeRequestSchema.parse({ fields: [alignmentField] })).toEqual({
      fields: [{ ...alignmentField, required: false, facetable: false }],
    });
  });

  it('rejects an empty patch that changes nothing', () => {
    expect(updateUserDefinedTypeRequestSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a duplicate-key fields patch', () => {
    expect(updateUserDefinedTypeRequestSchema.safeParse({ fields: [domainField, domainField] }).success).toBe(false);
  });

  it('accepts a fields + views patch placing the type’s own Structured Field (#201)', () => {
    const patch = updateUserDefinedTypeRequestSchema.parse({
      fields: [battlemapField],
      views: ['core.view.fields', { field: 'battlemap' }],
    });
    expect(patch.views).toEqual(['core.view.fields', { field: 'battlemap' }]);
  });

  it('rejects a views patch whose placement no surviving Field backs', () => {
    // The editor sends both lists together, so dropping the `battlemap` Field also drops its View.
    // A patch that drops the Field but keeps the placement is a bug, not a tolerated stale entry.
    const orphaned = updateUserDefinedTypeRequestSchema.safeParse({
      fields: [domainField],
      views: [{ field: 'battlemap' }],
    });
    expect(orphaned.success).toBe(false);
  });
});
