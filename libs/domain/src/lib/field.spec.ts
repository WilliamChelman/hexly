import { z } from 'zod';
import {
  defineField,
  deriveFieldFacets,
  entityLinkConstraints,
  entityLinkFieldValues,
  Field,
  FieldResolver,
  FieldSchema,
  fieldSchema,
  fieldSchemaSchema,
  FieldValidation,
  EntityDocument,
  parseFieldFilter,
  parseFieldFilters,
  readField,
  resolveEffectiveFields,
  resolvedStructuredDataTypeFields,
  unresolvedDataTypeErrors,
  validateFields,
  writeField,
} from './field';
import { defineStructuredDataType, NO_STRUCTURED_DATA_TYPES, structuredDataTypeSet } from './structured-data-type';
import { vaultSlotOf } from './field';

/** A terse FieldSchema builder for the specs — required/facetable default to false. */
function field(partial: Partial<FieldSchema> & Pick<FieldSchema, 'key' | 'dataType'>): FieldSchema {
  return fieldSchemaSchema.parse({ label: partial.key, ...partial });
}

/** `validateFields` takes the data-type set explicitly, and the built-in data-types need none of it. */
function validate(
  fields: readonly FieldSchema[],
  metadata: EntityDocument | undefined,
  dataTypes = NO_STRUCTURED_DATA_TYPES,
): FieldValidation {
  return validateFields(fields, metadata, dataTypes);
}

/** `deriveFieldFacets` takes the data-type set explicitly too; the scalar path needs none of it. */
function facets(
  fields: readonly FieldSchema[],
  doc: EntityDocument | undefined,
  dataTypes = NO_STRUCTURED_DATA_TYPES,
): ReturnType<typeof deriveFieldFacets> {
  return deriveFieldFacets(fields, doc, dataTypes);
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

describe('Field — first-class, reusable (ADR-0054)', () => {
  it('round-trips an `id` distinct from the `key` it lenses', () => {
    const parsed = fieldSchema.parse({
      id: 'world.element',
      key: 'element',
      label: 'Element',
      dataType: { kind: 'enum', options: ['fire', 'ice'] },
    });
    // id (the reuse handle) and key (the document key) are deliberately two things (ADR-0033/0054).
    expect(parsed.id).toBe('world.element');
    expect(parsed.key).toBe('element');
    expect({ required: parsed.required, facetable: parsed.facetable }).toEqual({ required: false, facetable: false });
  });

  describe('defineField — the code-registered Plugin field', () => {
    it('returns a frozen Field mirroring defineType', () => {
      const element = defineField({
        id: 'core.element',
        key: 'element',
        label: 'Element',
        labelKey: 'field.element',
        dataType: { kind: 'enum', options: ['fire', 'ice'] },
        facetable: true,
      });
      expect(element).toEqual({
        id: 'core.element',
        key: 'element',
        label: 'Element',
        labelKey: 'field.element',
        dataType: { kind: 'enum', options: ['fire', 'ice'] },
        required: false,
        facetable: true,
      });
      expect(Object.isFrozen(element)).toBe(true);
    });

    it('throws at load on a bare id (no namespace)', () => {
      expect(() =>
        defineField({ id: 'element', key: 'element', label: 'Element', dataType: { kind: 'string' } }),
      ).toThrow();
    });

    it('throws at load on an unknown data-type kind — but not on a well-formed structured one (membership is resolved later)', () => {
      expect(() => defineField({ id: 'core.k', key: 'k', label: 'K', dataType: { kind: 'geo' } as never })).toThrow();
      // A `namespace.id` kind is shape-valid here; an unregistered one dies at resolution, not load.
      expect(
        defineField({ id: 'core.map', key: 'grid', label: 'Grid', dataType: { kind: 'core.hex-grid' } }).dataType,
      ).toEqual({
        kind: 'core.hex-grid',
      });
    });
  });
});

describe('resolveEffectiveFields — the effective-set resolver (ADR-0054)', () => {
  // A small registry of first-class Fields, resolved by id.
  const element = defineField({ id: 'world.element', key: 'element', label: 'Element', dataType: { kind: 'string' } });
  const cr = defineField({ id: 'dnd.cr', key: 'cr', label: 'CR', dataType: { kind: 'number' } });
  const region = defineField({ id: 'world.region', key: 'region', label: 'Region', dataType: { kind: 'string' } });
  const registry = new Map<string, Field>([element, cr, region].map((f) => [f.id, f]));
  const fieldResolver: FieldResolver = (id) => registry.get(id);

  // The default `fieldRefs` of each type.
  const typeFieldRefs = (type: string) =>
    (({ 'dnd.beast': ['dnd.cr'], 'world.place': ['world.region'] }) as Record<string, string[]>)[type];

  it('unions an Entity’s attached Fields with its types’ default Fields (types primary-first)', () => {
    const effective = resolveEffectiveFields({
      types: ['dnd.beast', 'world.place'],
      fieldIds: ['world.element'],
      fieldResolver,
      typeFieldRefs,
    });
    // Instance attachment first, then each type's defaults in order.
    expect(effective.map((f) => f.key)).toEqual(['element', 'cr', 'region']);
  });

  it('drops an id that resolves to nothing — a disabled plugin / deleted World Field degrades to a plain value', () => {
    const effective = resolveEffectiveFields({
      types: ['dnd.beast'],
      fieldIds: ['world.gone'],
      fieldResolver,
      typeFieldRefs,
    });
    expect(effective.map((f) => f.id)).toEqual(['dnd.cr']);
  });

  describe('precedence on a shared key: instance > primary type > later types', () => {
    // Three Fields that all lens the same document key `k`.
    const instanceK = defineField({ id: 'world.k-inst', key: 'k', label: 'Instance', dataType: { kind: 'string' } });
    const primaryK = defineField({ id: 'a.k-primary', key: 'k', label: 'Primary', dataType: { kind: 'string' } });
    const laterK = defineField({ id: 'b.k-later', key: 'k', label: 'Later', dataType: { kind: 'string' } });
    const kRegistry = new Map<string, Field>([instanceK, primaryK, laterK].map((f) => [f.id, f]));
    const kResolver: FieldResolver = (id) => kRegistry.get(id);
    const kTypeRefs = (t: string) =>
      (({ 'a.type': ['a.k-primary'], 'b.type': ['b.k-later'] }) as Record<string, string[]>)[t];

    it('keeps the primary type’s Field over a later type’s on the same key', () => {
      const effective = resolveEffectiveFields({
        types: ['a.type', 'b.type'],
        fieldIds: [],
        fieldResolver: kResolver,
        typeFieldRefs: kTypeRefs,
      });
      expect(effective).toHaveLength(1);
      expect(effective[0].id).toBe('a.k-primary');
    });

    it('lets an instance attachment win the key over both types — the loser drops, its value untouched', () => {
      const effective = resolveEffectiveFields({
        types: ['a.type', 'b.type'],
        fieldIds: ['world.k-inst'],
        fieldResolver: kResolver,
        typeFieldRefs: kTypeRefs,
      });
      expect(effective).toHaveLength(1);
      expect(effective[0].id).toBe('world.k-inst');
      // The resolver never touches a document: it produces the set, and a losing Field's value stays put.
      const doc = { k: 'a value the dropped type-default would have lensed' };
      expect(doc.k).toBe('a value the dropped type-default would have lensed');
    });
  });

  // The whole point of the expand step: every downstream pure function already takes a `FieldSchema[]`,
  // and a resolved `Field[]` is a structural superset, so each runs over the effective set unchanged in
  // spirit (AC: validation, facet derivation, link-edge harvest, structured-field resolution, vault
  // projection over the effective set). A structured Field attached directly to an Entity — a deity's
  // `battleMap` — and an instance-attached link both flow through as a type default would.
  const battleMap = defineField({
    id: 'core.battle-map',
    key: 'battleMap',
    label: 'Battle Map',
    dataType: { kind: 'test.board' },
  });
  const lair = defineField({
    id: 'world.lair',
    key: 'lair',
    label: 'Lair',
    dataType: { kind: 'entityLink', targetTypes: ['world.place'] },
  });
  const richRegistry = new Map<string, Field>([...registry, [battleMap.id, battleMap], [lair.id, lair]]);
  const effective = resolveEffectiveFields({
    types: ['dnd.beast'],
    fieldIds: ['core.battle-map', 'world.lair'],
    fieldResolver: (id) => richRegistry.get(id),
    typeFieldRefs,
  });

  it('runs forward-only validation over the effective set — required-if-required, tolerant at rest', () => {
    // `cr` (a type default) present and well-typed passes; a missing required attached Field fails; an
    // ill-typed value at rest is tolerated (never retroactively invalidated).
    expect(validate(effective, { cr: 3 }, DATA_TYPES).ok).toBe(true);
    const required = resolveEffectiveFields({
      types: [],
      fieldIds: ['world.element'],
      fieldResolver: (id) => (id === 'world.element' ? { ...element, required: true } : undefined),
      typeFieldRefs,
    });
    expect(validate(required, {}).errors).toEqual([{ key: 'element', code: 'required' }]);
  });

  it('derives facets, resolves structured Fields, and harvests link edges over the effective set', () => {
    // Facets: only the facetable built-in (`cr` here is not facetable) — a structured Field never facets.
    expect(facets(effective, { cr: 3 }, DATA_TYPES)).toEqual([]);
    // Structured-field resolution: the attached `battleMap` resolves against the host set.
    expect(resolvedStructuredDataTypeFields(effective, DATA_TYPES).map((r) => r.field.key)).toEqual(['battleMap']);
    // Link-edge harvest: the attached `lair` link is harvested from the effective set like a type default.
    expect(entityLinkFieldValues(effective, { lair: { entityId: 'whisperwood', label: 'The Whisperwood' } })).toEqual([
      { key: 'lair', value: { entityId: 'whisperwood', label: 'The Whisperwood' } },
    ]);
    expect(entityLinkConstraints(effective, { lair: { entityId: 'whisperwood', label: 'The Whisperwood' } })).toEqual([
      { key: 'lair', entityId: 'whisperwood', targetTypes: ['world.place'] },
    ]);
  });

  it('resolves a Vault Projection slot over the effective set (a Field override wins the data-type default)', () => {
    const framed = defineStructuredDataType({
      id: 'test.framed',
      valueSchema: z.unknown(),
      empty: () => null,
      vault: { slot: 'frontmatter' },
    });
    const dataTypes = structuredDataTypeSet([framed]);
    const map = defineField({
      id: 'core.map',
      key: 'map',
      label: 'Map',
      dataType: { kind: 'test.framed' },
      vault: { slot: 'omit' },
    });
    const [resolved] = resolveEffectiveFields({
      types: [],
      fieldIds: ['core.map'],
      fieldResolver: (id) => (id === 'core.map' ? map : undefined),
      typeFieldRefs,
    });
    const [structured] = resolvedStructuredDataTypeFields([resolved], dataTypes);
    expect(vaultSlotOf(resolved, structured.dataType)).toBe('omit');
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

describe('deriveFieldFacets (the write-time denormalisation, a lens over EntityDocument)', () => {
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
    const derived = facets(fields, {
      cr: 10,
      size: 'large',
      born: '2026-07-11',
      senses: ['darkvision', 'truesight'],
      name: 'Aboleth',
    });
    expect(derived).toContainEqual({ key: 'cr', value: '10', num: 10 });
    expect(derived).toContainEqual({ key: 'size', value: 'large', num: null });
    expect(derived).toContainEqual({
      key: 'born',
      value: '2026-07-11',
      num: null,
    });
    // A list explodes to one row per item.
    expect(derived).toContainEqual({
      key: 'senses',
      value: 'darkvision',
      num: null,
    });
    expect(derived).toContainEqual({
      key: 'senses',
      value: 'truesight',
      num: null,
    });
    // A non-facetable Field is never materialised.
    expect(derived.some((f) => f.key === 'name')).toBe(false);
  });

  it('skips absent values and ill-typed values — data at rest is tolerated, not indexed', () => {
    // `cr` is present but the wrong type, `size` absent: neither reaches the facet index.
    expect(facets(fields, { cr: 'huge' })).toEqual([]);
    expect(facets(fields, undefined)).toEqual([]);
    // A list drops only the ill-typed items, keeping the good ones.
    expect(facets(fields, { senses: ['darkvision', 7] })).toEqual([{ key: 'senses', value: 'darkvision', num: null }]);
  });

  it('dedupes repeated values within one Entity so a count is per-Entity, not per-occurrence', () => {
    expect(facets(fields, { senses: ['darkvision', 'darkvision'] })).toEqual([
      { key: 'senses', value: 'darkvision', num: null },
    ]);
  });

  it('materialises an entityLink Field as its target id (a stable filter key, not the mutable name)', () => {
    const lairFields = [field({ key: 'lair', dataType: { kind: 'entityLink' }, facetable: true })];
    expect(facets(lairFields, { lair: { entityId: 'whisperwood', label: 'The Whisperwood' } })).toEqual([
      { key: 'lair', value: 'whisperwood', num: null },
    ]);
    // A malformed link (no entityId) is tolerated at rest, never indexed.
    expect(facets(lairFields, { lair: { label: 'Ghost' } })).toEqual([]);
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

describe('readField / writeField (a lens over the one EntityDocument map)', () => {
  const cr = field({ key: 'cr', dataType: { kind: 'number' } });

  it('reads a Field’s value straight off the EntityDocument map', () => {
    expect(readField({ cr: 7, other: 'x' }, cr)).toBe(7);
    expect(readField(undefined, cr)).toBeUndefined();
  });

  it('writes a value back into a fresh EntityDocument map, leaving sibling keys intact', () => {
    const next = writeField({ other: 'x' }, cr, 9);
    expect(next).toEqual({ other: 'x', cr: 9 });
  });

  it('does not mutate the input map (pure)', () => {
    const before = { cr: 1 };
    const after = writeField(before, cr, 2);
    expect(before).toEqual({ cr: 1 });
    expect(after).not.toBe(before);
  });

  it('clears the key when the value is emptied, leaving other EntityDocument untouched', () => {
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
 * The **Structured Data Type** — a data-type a plugin contributes (CONTEXT.md → Structured Data Type,
 * ADR-0050/0054). The set is open: a data-type is structured *iff* its kind is a `namespace.id` id,
 * so the domain validates the *shape* of a kind and the host resolves its *membership*.
 */
describe('Structured Data Type (ADR-0050)', () => {
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

    it('passes facetDimensions through unwrapped and wraps harvestFacets forward-only (ADR-0055)', () => {
      const statBlock = defineStructuredDataType({
        id: 'test.harvester',
        valueSchema: z.object({ cr: z.number() }),
        empty: () => ({ cr: 0 }),
        facetDimensions: [{ key: 'challenge_rating', labelKey: 'facet.cr', dataType: { kind: 'number' } }],
        harvestFacets: (block) => [{ key: 'challenge_rating', value: String(block.cr), num: block.cr }],
      });
      // The static declaration is the literal one passed in.
      expect(statBlock.facetDimensions).toEqual([
        { key: 'challenge_rating', labelKey: 'facet.cr', dataType: { kind: 'number' } },
      ]);
      expect(statBlock.harvestFacets?.({ cr: 5 })).toEqual([{ key: 'challenge_rating', value: '5', num: 5 }]);
      // Forward-only: a value the schema cannot parse harvests nothing, never a throw.
      expect(statBlock.harvestFacets?.('garbage')).toEqual([]);
      expect(statBlock.harvestFacets?.(undefined)).toEqual([]);
    });

    it('filters an emitted row whose key is not among the declared dimensions', () => {
      const leaky = defineStructuredDataType({
        id: 'test.leaky-def',
        valueSchema: z.object({ ok: z.string() }),
        empty: () => ({ ok: '' }),
        facetDimensions: [{ key: 'declared', labelKey: 'facet.declared', dataType: { kind: 'string' } }],
        harvestFacets: (v) => [
          { key: 'declared', value: v.ok, num: null },
          { key: 'stray', value: v.ok, num: null },
        ],
      });
      expect(leaky.harvestFacets?.({ ok: 'yes' })).toEqual([{ key: 'declared', value: 'yes', num: null }]);
    });

    it('leaves facetDimensions and harvestFacets absent when the data-type declares none', () => {
      expect(BOARD.facetDimensions).toBeUndefined();
      expect(BOARD.harvestFacets).toBeUndefined();
    });

    it('refuses to compose a set with a duplicate id', () => {
      expect(() => structuredDataTypeSet([BOARD, BOARD])).toThrow(/test\.board/);
    });

    it('carries an optional Vault Projection whose body converters see the raw value', () => {
      const prose = defineStructuredDataType({
        id: 'test.prose',
        valueSchema: z.object({ text: z.string() }),
        empty: () => ({ text: '' }),
        vault: {
          slot: 'body',
          // The value is passed unparsed (forward-only): a converter tolerates an off-shape value
          // rather than dropping it, so it narrows defensively itself.
          toMarkdown: (value) => String((value as { text?: unknown })?.text ?? ''),
          fromMarkdown: (markdown) => ({ text: markdown }),
        },
      });
      expect(prose.vault?.slot).toBe('body');
      const ctx = { entityName: () => undefined, assetPath: () => undefined };
      expect(prose.vault?.toMarkdown?.({ text: 'hi' }, ctx)).toBe('hi');
      expect(prose.vault?.toMarkdown?.('not the shape', ctx)).toBe('');
      const importCtx = { resolveLink: () => null, storeAsset: () => null, degrade: () => undefined };
      expect(prose.vault?.fromMarkdown?.('body text', importCtx)).toEqual({ text: 'body text' });
    });

    it('leaves the projection absent when the data-type declares none', () => {
      expect(BOARD.vault).toBeUndefined();
    });
  });

  describe('vaultSlotOf — a Field override wins over the data-type default', () => {
    const framed = defineStructuredDataType({
      id: 'test.framed',
      valueSchema: z.unknown(),
      empty: () => null,
      vault: { slot: 'frontmatter' },
    });

    it("takes the data-type's default when the Field declares no override", () => {
      expect(vaultSlotOf(field({ key: 'g', dataType: { kind: 'test.framed' } }), framed)).toBe('frontmatter');
    });

    it('honours a Field override', () => {
      const overridden = field({ key: 'g', dataType: { kind: 'test.framed' }, vault: { slot: 'omit' } });
      expect(vaultSlotOf(overridden, framed)).toBe('omit');
    });

    it('is undefined when neither Field nor data-type has an opinion', () => {
      expect(vaultSlotOf(field({ key: 'name', dataType: { kind: 'string' } }), undefined)).toBeUndefined();
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
      // A code-registered Field carries the same guard: a malformed kind throws at `defineField`.
      expect(() =>
        defineField({ id: 'test.name', key: 'name', label: 'Name', dataType: { kind: 'strig' } as never }),
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
    // value plain EntityDocument.
    it('is inert for an unregistered kind — never blocking the save of an Entity whose plugin is absent', () => {
      // The empty set stands for the build without the plugin: nothing resolves `test.board`.
      expect(validate([boardField], { board: { tiles: [{ entityId: 'riverbend' }] } }).ok).toBe(true);
      expect(validate([boardField], { board: 'garbage' }).ok).toBe(true);
      expect(validate([{ ...boardField, required: true }], {}).ok).toBe(true);
    });
  });

  describe('deriveFieldFacets and a Field of a Structured Data Type (ADR-0055)', () => {
    it('never facets a structured Field *directly*, whatever its facetable flag says', () => {
      // `test.board` declares no dimensions and harvests nothing: the blob has no values to count.
      const facetable = field({ key: 'board', dataType: { kind: 'test.board' }, facetable: true });
      expect(facets([facetable], { board: { tiles: [{ entityId: 'riverbend' }] } }, DATA_TYPES)).toEqual([]);
    });

    /**
     * A stand-in for `dnd.stat-block` (ADR-0055): a structured value that *harvests* facet dimensions.
     * It declares three — a numeric `challenge_rating`, an enum `size`, and a `creature_type` sharing the
     * `type` key a scalar Field also lenses — and emits their values per Entity.
     */
    const STAT_BLOCK = defineStructuredDataType({
      id: 'test.stat-block',
      valueSchema: z.object({ cr: z.number(), size: z.string(), kind: z.string() }),
      empty: () => ({ cr: 0, size: 'medium', kind: 'beast' }),
      facetDimensions: [
        { key: 'challenge_rating', labelKey: 'facet.cr', dataType: { kind: 'number' } },
        { key: 'size', labelKey: 'facet.size', dataType: { kind: 'enum', options: ['small', 'large'] } },
        { key: 'type', labelKey: 'facet.type', dataType: { kind: 'string' } },
      ],
      harvestFacets: (block) => [
        { key: 'challenge_rating', value: String(block.cr), num: block.cr },
        { key: 'size', value: block.size, num: null },
        { key: 'type', value: block.kind, num: null },
      ],
    });
    const withStatBlock = structuredDataTypeSet([STAT_BLOCK]);
    const statField = field({ key: 'stat_block', dataType: { kind: 'test.stat-block' } });
    const statBlock = { stat_block: { cr: 5, size: 'large', kind: 'dragon' } };

    it('harvests the declared dimensions from a structured value, numeric dimension keeping its num', () => {
      expect(facets([statField], statBlock, withStatBlock)).toEqual([
        { key: 'challenge_rating', value: '5', num: 5 },
        { key: 'size', value: 'large', num: null },
        { key: 'type', value: 'dragon', num: null },
      ]);
    });

    it('harvests nothing from an absent or ill-typed value at rest, rather than throwing', () => {
      expect(facets([statField], {}, withStatBlock)).toEqual([]);
      expect(facets([statField], { stat_block: 'garbage' }, withStatBlock)).toEqual([]);
    });

    it('harvests nothing when the structured kind is unregistered — an absent plugin degrades cleanly', () => {
      expect(facets([statField], statBlock, NO_STRUCTURED_DATA_TYPES)).toEqual([]);
    });

    it('drops a row under a key the data-type never declared — an undeclared dimension is never emitted', () => {
      const leaky = defineStructuredDataType({
        id: 'test.leaky',
        valueSchema: z.object({ ok: z.string() }),
        empty: () => ({ ok: '' }),
        facetDimensions: [{ key: 'declared', labelKey: 'facet.declared', dataType: { kind: 'string' } }],
        // Emits one declared row and one stray, undeclared key.
        harvestFacets: (v) => [
          { key: 'declared', value: v.ok, num: null },
          { key: 'stray', value: v.ok, num: null },
        ],
      });
      const leakyField = field({ key: 'leaky', dataType: { kind: 'test.leaky' } });
      expect(facets([leakyField], { leaky: { ok: 'yes' } }, structuredDataTypeSet([leaky]))).toEqual([
        { key: 'declared', value: 'yes', num: null },
      ]);
    });

    it('merges a harvested key sharing a scalar Field key into one bucket, the scalar winning a collision', () => {
      // The scalar `type` Field and the stat block's `type` dimension share the flat key space. Distinct
      // values union under `type`; a coinciding (key, value) collapses, the scalar row (its `num`) winning.
      const scalarType = field({ key: 'type', dataType: { kind: 'string' }, facetable: true });
      const doc = { type: 'humanoid', stat_block: { cr: 5, size: 'large', kind: 'dragon' } };
      expect(facets([scalarType, statField], doc, withStatBlock)).toEqual([
        { key: 'type', value: 'humanoid', num: null },
        { key: 'challenge_rating', value: '5', num: 5 },
        { key: 'size', value: 'large', num: null },
        { key: 'type', value: 'dragon', num: null },
      ]);
      // When both resolve the same (key, value), the scalar row — walked first — is the one kept.
      const collide = { type: 'dragon', stat_block: { cr: 5, size: 'large', kind: 'dragon' } };
      const merged = facets([scalarType, statField], collide, withStatBlock).filter((f) => f.key === 'type');
      expect(merged).toEqual([{ key: 'type', value: 'dragon', num: null }]);
    });
  });
});
