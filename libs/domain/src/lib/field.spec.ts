import { z } from 'zod';
import {
  deriveFieldFacets,
  entityLinkConstraints,
  entityLinkFieldValues,
  FieldSchema,
  fieldSchemaSchema,
  FieldValidation,
  Metadata,
  parseFieldFilter,
  parseFieldFilters,
  readField,
  resolveFields,
  unresolvedDataTypeErrors,
  validateFields,
  writeField,
} from './field';
import { defineStructuredDataType, NO_STRUCTURED_DATA_TYPES, structuredDataTypeSet } from './structured-data-type';
import { defineType } from './plugin-type';

/** A terse FieldSchema builder for the specs — required/facetable default to false. */
function field(partial: Partial<FieldSchema> & Pick<FieldSchema, 'key' | 'dataType'>): FieldSchema {
  return fieldSchemaSchema.parse({ label: partial.key, ...partial });
}

/** `validateFields` takes the data-type set explicitly, and the built-in data-types need none of it. */
function validate(
  fields: readonly FieldSchema[],
  metadata: Metadata | undefined,
  dataTypes = NO_STRUCTURED_DATA_TYPES,
): FieldValidation {
  return validateFields(fields, metadata, dataTypes);
}

/** A stand-in for a plugin's structured data-type. */
const BOARD = defineStructuredDataType({
  id: 'test.board',
  valueSchema: z.object({ tiles: z.array(z.object({ entityId: z.string() })) }),
  empty: () => ({ tiles: [] }),
  harvestEdges: (board) =>
    board.tiles.map((tile) => ({ targetKind: 'entity' as const, targetId: tile.entityId, descriptor: null })),
});

const DATA_TYPES = structuredDataTypeSet([BOARD]);

const boardField = field({ key: 'board', dataType: { kind: 'test.board' } });

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
    expect(
      fieldSchemaSchema.safeParse({
        key: 'k',
        label: 'K',
        dataType: { kind: 'geo' },
      }).success,
    ).toBe(false);
    expect(
      fieldSchemaSchema.safeParse({
        key: 'k',
        label: 'K',
        dataType: { kind: 'enum', options: [] },
      }).success,
    ).toBe(false);
    expect(
      fieldSchemaSchema.safeParse({
        key: 'k',
        label: 'K',
        dataType: {
          kind: 'list',
          of: { kind: 'list', of: { kind: 'string' } },
        },
      }).success,
    ).toBe(false);
  });

  it('accepts an entityLink, with or without a target-type constraint (#190)', () => {
    expect(fieldSchemaSchema.parse({ key: 'lair', label: 'Lair', dataType: { kind: 'entityLink' } }).dataType).toEqual({
      kind: 'entityLink',
    });
    expect(
      fieldSchemaSchema.parse({
        key: 'lair',
        label: 'Lair',
        dataType: { kind: 'entityLink', targetTypes: ['world.place'] },
      }).dataType,
    ).toEqual({ kind: 'entityLink', targetTypes: ['world.place'] });
  });

  it('rejects an entityLink whose target-type constraint is not a `namespace.id` key', () => {
    expect(
      fieldSchemaSchema.safeParse({
        key: 'lair',
        label: 'Lair',
        dataType: { kind: 'entityLink', targetTypes: ['place'] },
      }).success,
    ).toBe(false);
  });
});

describe('resolveFields', () => {
  const beast = [field({ key: 'cr', dataType: { kind: 'number' } })];
  const place = [field({ key: 'region', dataType: { kind: 'string' } })];
  const resolver = (type: string) =>
    (({ 'dnd.beast': beast, 'world.place': place }) as Record<string, FieldSchema[]>)[type];

  it('unions the resolved Field schemas of a types[] set, primary type first', () => {
    expect(resolveFields(resolver, ['dnd.beast', 'world.place']).map((f) => f.key)).toEqual(['cr', 'region']);
  });

  it('dedupes by key, keeping the primary type’s declaration when two types share a key', () => {
    const a = [field({ key: 'name', dataType: { kind: 'string' }, label: 'A name' })];
    const b = [field({ key: 'name', dataType: { kind: 'number' }, label: 'B name' })];
    const both = (t: string) => (({ 'a.type': a, 'b.type': b }) as Record<string, FieldSchema[]>)[t];
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
    field({
      key: 'size',
      dataType: { kind: 'enum', options: ['small', 'large'] },
    }),
    field({
      key: 'senses',
      dataType: { kind: 'list', of: { kind: 'string' } },
    }),
  ];

  it('passes well-typed data with the required Field present', () => {
    const result = validate(fields, {
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
    expect(validate(fields, { name: 'Kobold' }).ok).toBe(true);
    // No metadata at all still passes as long as no required Field exists — here `name` is required.
    expect(validate([fields[1]], undefined).ok).toBe(true);
  });

  it('rejects a missing required Field', () => {
    const result = validate(fields, { cr: 1 });
    expect(result.ok).toBe(false);
    expect(result.errors).toContainEqual({ key: 'name', code: 'required' });
  });

  it('rejects a wrong data-type for each kind', () => {
    const wrong = validate(fields, {
      name: 42,
      cr: 'ten',
      legendary: 'yes',
      born: 'last tuesday',
      size: 'gargantuan',
      senses: ['darkvision', 7],
    });
    expect(wrong.ok).toBe(false);
    expect(wrong.errors.map((e) => e.key).sort()).toEqual(['born', 'cr', 'legendary', 'name', 'senses', 'size']);
    expect(wrong.errors.every((e) => e.code === 'type')).toBe(true);
  });

  it('accepts a full ISO datetime and rejects an out-of-range calendar date', () => {
    const dateField = [field({ key: 'born', dataType: { kind: 'date' } })];
    expect(validate(dateField, { born: '2026-07-11T09:30:00Z' }).ok).toBe(true);
    expect(validate(dateField, { born: '2026-13-40' }).ok).toBe(false);
  });

  it('rejects a NaN / non-finite number', () => {
    const numberField = [field({ key: 'cr', dataType: { kind: 'number' } })];
    expect(validate(numberField, { cr: Number.NaN }).ok).toBe(false);
    expect(validate(numberField, { cr: Infinity }).ok).toBe(false);
  });
});

describe('deriveFieldFacets (the write-time denormalisation, a lens over Metadata)', () => {
  const fields: FieldSchema[] = [
    field({ key: 'cr', dataType: { kind: 'number' }, facetable: true }),
    field({
      key: 'size',
      dataType: { kind: 'enum', options: ['small', 'large'] },
      facetable: true,
    }),
    field({ key: 'born', dataType: { kind: 'date' }, facetable: true }),
    field({
      key: 'senses',
      dataType: { kind: 'list', of: { kind: 'string' } },
      facetable: true,
    }),
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
    expect(facets).toContainEqual({
      key: 'born',
      value: '2026-07-11',
      num: null,
    });
    // A list explodes to one row per item.
    expect(facets).toContainEqual({
      key: 'senses',
      value: 'darkvision',
      num: null,
    });
    expect(facets).toContainEqual({
      key: 'senses',
      value: 'truesight',
      num: null,
    });
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

  it('materialises an entityLink Field as its target id (a stable filter key, not the mutable name)', () => {
    const lairFields = [field({ key: 'lair', dataType: { kind: 'entityLink' }, facetable: true })];
    expect(deriveFieldFacets(lairFields, { lair: { entityId: 'whisperwood', label: 'The Whisperwood' } })).toEqual([
      { key: 'lair', value: 'whisperwood', num: null },
    ]);
    // A malformed link (no entityId) is tolerated at rest, never indexed.
    expect(deriveFieldFacets(lairFields, { lair: { label: 'Ghost' } })).toEqual([]);
  });
});

describe('entityLink Fields (#190)', () => {
  const lair = field({ key: 'lair', dataType: { kind: 'entityLink', targetTypes: ['world.place'] } });
  const ally = field({ key: 'ally', dataType: { kind: 'entityLink' } });

  it('validates the value shape forward-only — an object with a non-blank entityId', () => {
    expect(validate([lair], { lair: { entityId: 'whisperwood', label: 'The Whisperwood' } }).ok).toBe(true);
    // Bare id, a string, and a blank-id object all fail the shape gate.
    expect(validate([lair], { lair: 'whisperwood' }).ok).toBe(false);
    expect(validate([lair], { lair: { entityId: '  ' } }).ok).toBe(false);
    // Absent is fine for an optional Field.
    expect(validate([lair], {}).ok).toBe(true);
  });

  it('reads each present, shape-valid Entity-Link Field value as an edge target', () => {
    expect(
      entityLinkFieldValues([lair, ally], {
        lair: { entityId: 'whisperwood', label: 'The Whisperwood' },
        ally: { entityId: 'mira' },
      }),
    ).toEqual([
      { key: 'lair', value: { entityId: 'whisperwood', label: 'The Whisperwood' } },
      { key: 'ally', value: { entityId: 'mira', label: '' } },
    ]);
    // A blank / ill-typed value contributes no edge.
    expect(entityLinkFieldValues([lair], { lair: { label: 'Ghost' } })).toEqual([]);
  });

  it('surfaces only *constrained*, present links for the write-gate target-type check', () => {
    expect(
      entityLinkConstraints([lair, ally], {
        lair: { entityId: 'whisperwood', label: 'The Whisperwood' },
        // `ally` has no targetTypes → nothing to enforce, even when set.
        ally: { entityId: 'mira' },
      }),
    ).toEqual([{ key: 'lair', entityId: 'whisperwood', targetTypes: ['world.place'] }]);
    // An absent constrained link has no target to check.
    expect(entityLinkConstraints([lair], {})).toEqual([]);
  });
});

describe('parseFieldFilter (`key:op:value`)', () => {
  it('parses each op, splitting on the first two colons so a value keeps its own', () => {
    expect(parseFieldFilter('cr:gte:5')).toEqual({
      key: 'cr',
      op: 'gte',
      value: '5',
    });
    expect(parseFieldFilter('size:eq:large')).toEqual({
      key: 'size',
      op: 'eq',
      value: 'large',
    });
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
    expect(writeField({ cr: 1, other: 'x' }, cr, undefined)).toEqual({
      other: 'x',
    });
    expect(writeField({ cr: 1 }, cr, '')).toEqual({});
    expect(
      writeField(
        { senses: ['a'] },
        field({
          key: 'senses',
          dataType: { kind: 'list', of: { kind: 'string' } },
        }),
        [],
      ),
    ).toEqual({});
  });
});

/**
 * The **Structured Field** — a Field whose data-type a plugin contributes (CONTEXT.md → Structured
 * Field, ADR-0050). The set is open: a data-type is structured *iff* its kind is a `namespace.id` id,
 * so the domain validates the *shape* of a kind and the host resolves its *membership*.
 */
describe('Structured Field data-types (ADR-0050)', () => {
  describe('defineStructuredDataType — the framework-free declaration', () => {
    it('declares an id, a value schema, an empty value, and an optional edge harvester', () => {
      expect(BOARD.id).toBe('test.board');
      expect(BOARD.empty()).toEqual({ tiles: [] });
      expect(BOARD.harvestEdges?.({ tiles: [{ entityId: 'riverbend' }] })).toEqual([
        { targetKind: 'entity', targetId: 'riverbend', descriptor: null },
      ]);
    });

    it('rejects an id that is not `namespace.id`-shaped, at declaration', () => {
      expect(() => defineStructuredDataType({ id: 'board', valueSchema: z.unknown(), empty: () => null })).toThrow();
      // Never trimmed: the id is the key a Field's `kind` is looked up under, so a padded one would
      // register a data-type that could never resolve.
      expect(() =>
        defineStructuredDataType({ id: ' test.board ', valueSchema: z.unknown(), empty: () => null }),
      ).toThrow();
    });

    it('yields no edges for a value its schema cannot parse — forward-only, never a throw', () => {
      expect(BOARD.harvestEdges?.({ tiles: 'garbage' })).toEqual([]);
      expect(BOARD.harvestEdges?.(undefined)).toEqual([]);
    });

    it('leaves the harvester absent when the data-type declares none', () => {
      const swatch = defineStructuredDataType({
        id: 'test.swatch',
        valueSchema: z.object({ rgb: z.string() }),
        empty: () => ({ rgb: '#000000' }),
      });
      expect(swatch.harvestEdges).toBeUndefined();
    });

    it('refuses to compose a set with a duplicate id', () => {
      expect(() => structuredDataTypeSet([BOARD, BOARD])).toThrow(/test\.board/);
    });
  });

  describe('declaring a Field that names one', () => {
    it('accepts a well-formed `namespace.id` kind', () => {
      expect(boardField.dataType).toEqual({ kind: 'test.board' });
      // Shape, not membership: `defineType()` runs at module load, so no schema could enumerate the
      // very plugin registering a kind. A well-formed typo passes here and dies at resolution.
      expect(field({ key: 'board', dataType: { kind: 'test.bord' } }).dataType).toEqual({ kind: 'test.bord' });
    });

    it('rejects a kind that is neither a built-in nor `namespace.id`-shaped', () => {
      expect(() => field({ key: 'name', dataType: { kind: 'strig' } as never })).toThrow();
      expect(() =>
        defineType({
          id: 'test.thing',
          label: 'Thing',
          fields: [{ key: 'name', label: 'Name', dataType: { kind: 'strig' } } as never],
        }),
      ).toThrow();
    });
  });

  describe('unresolvedDataTypeErrors — where an unregistered kind is rejected', () => {
    it('flags a well-formed but unregistered kind, against the host-composed set', () => {
      const typo = field({ key: 'grid', dataType: { kind: 'test.bord' } });
      expect(unresolvedDataTypeErrors([typo], DATA_TYPES)).toEqual([{ key: 'grid', code: 'unknown-data-type' }]);
    });

    it('resolves against the set it is handed, not a global — an empty set knows no structured kind', () => {
      expect(unresolvedDataTypeErrors([boardField], NO_STRUCTURED_DATA_TYPES)).toEqual([
        { key: 'board', code: 'unknown-data-type' },
      ]);
      expect(unresolvedDataTypeErrors([boardField], DATA_TYPES)).toEqual([]);
    });

    it('never flags a built-in data-type', () => {
      expect(unresolvedDataTypeErrors([field({ key: 'cr', dataType: { kind: 'number' } })], DATA_TYPES)).toEqual([]);
    });
  });

  describe('validateFields against a host-composed data-type set', () => {
    it('validates a present value against the data-type’s own schema', () => {
      expect(validate([boardField], { board: { tiles: [] } }, DATA_TYPES).ok).toBe(true);
      expect(validate([boardField], { board: { tiles: [{ entityId: 'riverbend' }] } }, DATA_TYPES).ok).toBe(true);
      expect(validate([boardField], { board: { tiles: 'garbage' } }, DATA_TYPES).errors).toEqual([
        { key: 'board', code: 'type' },
      ]);
    });

    it('leaves an absent optional value alone, and still misses a required one', () => {
      expect(validate([boardField], {}, DATA_TYPES).ok).toBe(true);
      expect(validate([{ ...boardField, required: true }], {}, DATA_TYPES).errors).toEqual([
        { key: 'board', code: 'required' },
      ]);
    });

    // The absent-plugin path (ADR-0050): a Field whose data-type went missing stays saveable, its
    // value plain Metadata.
    it('is inert for an unregistered kind — never blocking the save of an Entity whose plugin is absent', () => {
      // The empty set stands for the build without the plugin: nothing resolves `test.board`.
      expect(validate([boardField], { board: { tiles: [{ entityId: 'riverbend' }] } }).ok).toBe(true);
      expect(validate([boardField], { board: 'garbage' }).ok).toBe(true);
      expect(validate([{ ...boardField, required: true }], {}).ok).toBe(true);
    });
  });

  describe('deriveFieldFacets and a Structured Field', () => {
    it('never facets one, whatever its facetable flag says — a document has no values to count', () => {
      const facetable = field({ key: 'board', dataType: { kind: 'test.board' }, facetable: true });
      expect(deriveFieldFacets([facetable], { board: { tiles: [{ entityId: 'riverbend' }] } })).toEqual([]);
    });
  });
});
