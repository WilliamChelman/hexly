import {
  deriveFieldFacets,
  FieldSchema,
  fieldSchemaSchema,
  parseFieldFilter,
  parseFieldFilters,
  readField,
  resolveFields,
  validateFields,
  writeField,
} from './field';

/** A terse FieldSchema builder for the specs — required/facetable default to false. */
function field(partial: Partial<FieldSchema> & Pick<FieldSchema, 'key' | 'dataType'>): FieldSchema {
  return fieldSchemaSchema.parse({ label: partial.key, ...partial });
}

describe('fieldSchemaSchema', () => {
  it('accepts a scalar / enum / date / list declaration and defaults required + facetable to false', () => {
    const parsed = fieldSchemaSchema.parse({
      key: 'cr',
      label: 'Challenge Rating',
      dataType: { kind: 'number' },
    });
    expect(parsed).toEqual({
      key: 'cr',
      label: 'Challenge Rating',
      dataType: { kind: 'number' },
      required: false,
      facetable: false,
    });
  });

  it('accepts an enum with options and a list of a scalar item type', () => {
    expect(
      fieldSchemaSchema.parse({
        key: 'size',
        label: 'Size',
        dataType: { kind: 'enum', options: ['small', 'medium', 'large'] },
      }).dataType,
    ).toEqual({ kind: 'enum', options: ['small', 'medium', 'large'] });

    expect(
      fieldSchemaSchema.parse({
        key: 'senses',
        label: 'Senses',
        dataType: { kind: 'list', of: { kind: 'string' } },
      }).dataType,
    ).toEqual({ kind: 'list', of: { kind: 'string' } });
  });

  it('rejects an unknown data-type kind, an empty enum, and a list of a list', () => {
    expect(fieldSchemaSchema.safeParse({ key: 'k', label: 'K', dataType: { kind: 'entityLink' } }).success).toBe(false);
    expect(
      fieldSchemaSchema.safeParse({ key: 'k', label: 'K', dataType: { kind: 'enum', options: [] } }).success,
    ).toBe(false);
    expect(
      fieldSchemaSchema.safeParse({
        key: 'k',
        label: 'K',
        dataType: { kind: 'list', of: { kind: 'list', of: { kind: 'string' } } },
      }).success,
    ).toBe(false);
  });
});

describe('resolveFields', () => {
  const beast = [field({ key: 'cr', dataType: { kind: 'number' } })];
  const place = [field({ key: 'region', dataType: { kind: 'string' } })];
  const resolver = (type: string) =>
    ({ 'dnd.beast': beast, 'world.place': place } as Record<string, FieldSchema[]>)[type];

  it('unions the resolved Field schemas of a types[] set, primary type first', () => {
    expect(resolveFields(resolver, ['dnd.beast', 'world.place']).map((f) => f.key)).toEqual([
      'cr',
      'region',
    ]);
  });

  it('dedupes by key, keeping the primary type’s declaration when two types share a key', () => {
    const a = [field({ key: 'name', dataType: { kind: 'string' }, label: 'A name' })];
    const b = [field({ key: 'name', dataType: { kind: 'number' }, label: 'B name' })];
    const both = (t: string) => ({ 'a.type': a, 'b.type': b } as Record<string, FieldSchema[]>)[t];
    const resolved = resolveFields(both, ['a.type', 'b.type']);
    expect(resolved).toHaveLength(1);
    expect(resolved[0].label).toBe('A name');
  });

  it('returns no fields for a types[] set whose types declare none — values stay plain Metadata', () => {
    // A missing/absent type resolves to nothing, so its Metadata is never surfaced as a Field.
    expect(resolveFields(resolver, ['core.note'])).toEqual([]);
    expect(resolveFields(resolver, [])).toEqual([]);
  });
});

describe('validateFields (forward-only)', () => {
  const fields: FieldSchema[] = [
    field({ key: 'name', dataType: { kind: 'string' }, required: true }),
    field({ key: 'cr', dataType: { kind: 'number' } }),
    field({ key: 'legendary', dataType: { kind: 'boolean' } }),
    field({ key: 'born', dataType: { kind: 'date' } }),
    field({ key: 'size', dataType: { kind: 'enum', options: ['small', 'large'] } }),
    field({ key: 'senses', dataType: { kind: 'list', of: { kind: 'string' } } }),
  ];

  it('passes well-typed data with the required Field present', () => {
    const result = validateFields(fields, {
      name: 'Aboleth',
      cr: 10,
      legendary: true,
      born: '2026-07-11',
      size: 'large',
      senses: ['darkvision', 'truesight'],
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('passes when an optional Field is simply absent', () => {
    expect(validateFields(fields, { name: 'Kobold' }).ok).toBe(true);
    // No metadata at all still passes as long as no required Field exists — here `name` is required.
    expect(validateFields([fields[1]], undefined).ok).toBe(true);
  });

  it('rejects a missing required Field', () => {
    const result = validateFields(fields, { cr: 1 });
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({ key: 'name', code: 'required' });
  });

  it('rejects a wrong data-type for each kind', () => {
    const wrong = validateFields(fields, {
      name: 42,
      cr: 'ten',
      legendary: 'yes',
      born: 'last tuesday',
      size: 'gargantuan',
      senses: ['darkvision', 7],
    });
    expect(wrong.ok).toBe(false);
    expect(wrong.errors.map((e) => e.key).sort()).toEqual([
      'born',
      'cr',
      'legendary',
      'name',
      'senses',
      'size',
    ]);
    expect(wrong.errors.every((e) => e.code === 'type')).toBe(true);
  });

  it('accepts a full ISO datetime and rejects an out-of-range calendar date', () => {
    const dateField = [field({ key: 'born', dataType: { kind: 'date' } })];
    expect(validateFields(dateField, { born: '2026-07-11T09:30:00Z' }).ok).toBe(true);
    expect(validateFields(dateField, { born: '2026-13-40' }).ok).toBe(false);
  });

  it('rejects a NaN / non-finite number', () => {
    const numberField = [field({ key: 'cr', dataType: { kind: 'number' } })];
    expect(validateFields(numberField, { cr: Number.NaN }).ok).toBe(false);
    expect(validateFields(numberField, { cr: Infinity }).ok).toBe(false);
  });
});

describe('deriveFieldFacets (the write-time denormalisation, a lens over Metadata)', () => {
  const fields: FieldSchema[] = [
    field({ key: 'cr', dataType: { kind: 'number' }, facetable: true }),
    field({ key: 'size', dataType: { kind: 'enum', options: ['small', 'large'] }, facetable: true }),
    field({ key: 'born', dataType: { kind: 'date' }, facetable: true }),
    field({ key: 'senses', dataType: { kind: 'list', of: { kind: 'string' } }, facetable: true }),
    // Declared but NOT facetable — never materialised.
    field({ key: 'name', dataType: { kind: 'string' }, facetable: false }),
  ];

  it('materialises each facetable Field value, tagging a number with its numeric form', () => {
    const facets = deriveFieldFacets(fields, {
      cr: 10,
      size: 'large',
      born: '2026-07-11',
      senses: ['darkvision', 'truesight'],
      name: 'Aboleth',
    });
    expect(facets).toContainEqual({ key: 'cr', value: '10', num: 10 });
    expect(facets).toContainEqual({ key: 'size', value: 'large', num: null });
    expect(facets).toContainEqual({ key: 'born', value: '2026-07-11', num: null });
    // A list explodes to one row per item.
    expect(facets).toContainEqual({ key: 'senses', value: 'darkvision', num: null });
    expect(facets).toContainEqual({ key: 'senses', value: 'truesight', num: null });
    // A non-facetable Field is never materialised.
    expect(facets.some((f) => f.key === 'name')).toBe(false);
  });

  it('skips absent values and ill-typed values — data at rest is tolerated, not indexed', () => {
    // `cr` is present but the wrong type, `size` absent: neither reaches the facet index.
    expect(deriveFieldFacets(fields, { cr: 'huge' })).toEqual([]);
    expect(deriveFieldFacets(fields, undefined)).toEqual([]);
    // A list drops only the ill-typed items, keeping the good ones.
    expect(deriveFieldFacets(fields, { senses: ['darkvision', 7] })).toEqual([
      { key: 'senses', value: 'darkvision', num: null },
    ]);
  });

  it('dedupes repeated values within one Entity so a count is per-Entity, not per-occurrence', () => {
    expect(deriveFieldFacets(fields, { senses: ['darkvision', 'darkvision'] })).toEqual([
      { key: 'senses', value: 'darkvision', num: null },
    ]);
  });
});

describe('parseFieldFilter (`key:op:value`)', () => {
  it('parses each op, splitting on the first two colons so a value keeps its own', () => {
    expect(parseFieldFilter('cr:gte:5')).toEqual({ key: 'cr', op: 'gte', value: '5' });
    expect(parseFieldFilter('size:eq:large')).toEqual({ key: 'size', op: 'eq', value: 'large' });
    // An ISO datetime value carries colons — they belong to the value, not the delimiter.
    expect(parseFieldFilter('born:lte:2026-07-11T09:30:00Z')).toEqual({
      key: 'born',
      op: 'lte',
      value: '2026-07-11T09:30:00Z',
    });
  });

  it('returns null for a malformed token so a stale URL is dropped, never a 400', () => {
    expect(parseFieldFilter('cr:5')).toBeNull(); // no op
    expect(parseFieldFilter('cr:between:5')).toBeNull(); // unknown op
    expect(parseFieldFilter('cr:eq:')).toBeNull(); // empty value
    expect(parseFieldFilter(':eq:5')).toBeNull(); // empty key
    expect(parseFieldFilter('nonsense')).toBeNull();
  });

  it('parseFieldFilters keeps the valid tokens and drops the rest', () => {
    expect(parseFieldFilters(['cr:gte:5', 'garbage', 'size:eq:large'])).toEqual([
      { key: 'cr', op: 'gte', value: '5' },
      { key: 'size', op: 'eq', value: 'large' },
    ]);
    expect(parseFieldFilters(undefined)).toEqual([]);
  });
});

describe('readField / writeField (a lens over the one Metadata map)', () => {
  const cr = field({ key: 'cr', dataType: { kind: 'number' } });

  it('reads a Field’s value straight off the Metadata map', () => {
    expect(readField({ cr: 7, other: 'x' }, cr)).toBe(7);
    expect(readField(undefined, cr)).toBeUndefined();
  });

  it('writes a value back into a fresh Metadata map, leaving sibling keys intact', () => {
    const next = writeField({ other: 'x' }, cr, 9);
    expect(next).toEqual({ other: 'x', cr: 9 });
  });

  it('does not mutate the input map (pure)', () => {
    const before = { cr: 1 };
    const after = writeField(before, cr, 2);
    expect(before).toEqual({ cr: 1 });
    expect(after).not.toBe(before);
  });

  it('clears the key when the value is emptied, leaving other Metadata untouched', () => {
    expect(writeField({ cr: 1, other: 'x' }, cr, undefined)).toEqual({ other: 'x' });
    expect(writeField({ cr: 1 }, cr, '')).toEqual({});
    expect(
      writeField({ senses: ['a'] }, field({ key: 'senses', dataType: { kind: 'list', of: { kind: 'string' } } }), []),
    ).toEqual({});
  });
});
