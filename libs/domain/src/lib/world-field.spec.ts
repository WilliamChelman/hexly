import {
  createWorldFieldRequestSchema,
  updateWorldFieldRequestSchema,
  userDefinedFieldIdSchema,
  worldFieldSchema,
} from './world-field';

const elementField = {
  id: 'world.element',
  key: 'element',
  label: 'Element',
  dataType: { kind: 'enum' as const, options: ['fire', 'ice', 'water'] },
};

describe('userDefinedFieldIdSchema', () => {
  it('accepts a `world.`-namespaced id', () => {
    expect(userDefinedFieldIdSchema.parse('world.element')).toBe('world.element');
  });

  it('rejects a plugin/core namespace and a bare id', () => {
    expect(userDefinedFieldIdSchema.safeParse('dnd.size').success).toBe(false);
    expect(userDefinedFieldIdSchema.safeParse('core.content').success).toBe(false);
    // A bare `world` (no `.id`) is not a valid `namespace.id` key at all.
    expect(userDefinedFieldIdSchema.safeParse('world').success).toBe(false);
  });
});

describe('worldFieldSchema', () => {
  it('parses a `world.` id + Field body, defaulting required/facetable', () => {
    expect(worldFieldSchema.parse(elementField)).toEqual({ ...elementField, required: false, facetable: false });
  });

  it('carries an enum’s options on the Field (ADR-0054)', () => {
    const parsed = worldFieldSchema.parse(elementField);
    expect(parsed.dataType).toEqual({ kind: 'enum', options: ['fire', 'ice', 'water'] });
  });

  it('rejects a non-`world.` id and a bare id', () => {
    expect(worldFieldSchema.safeParse({ ...elementField, id: 'dnd.element' }).success).toBe(false);
    expect(worldFieldSchema.safeParse({ ...elementField, id: 'element' }).success).toBe(false);
  });
});

describe('createWorldFieldRequestSchema', () => {
  it('requires a `world.` id, a key, a label, and a data-type', () => {
    expect(createWorldFieldRequestSchema.safeParse({ key: 'element', label: 'Element' }).success).toBe(false);
    expect(createWorldFieldRequestSchema.parse(elementField)).toEqual({
      ...elementField,
      required: false,
      facetable: false,
    });
  });
});

describe('updateWorldFieldRequestSchema', () => {
  it('takes the Field body wholesale, without an id', () => {
    const body = { key: 'element', label: 'Elemental affinity', dataType: { kind: 'string' as const } };
    expect(updateWorldFieldRequestSchema.parse(body)).toEqual({ ...body, required: false, facetable: false });
  });

  it('rejects a body missing its key or data-type', () => {
    expect(updateWorldFieldRequestSchema.safeParse({ label: 'Element' }).success).toBe(false);
  });
});
