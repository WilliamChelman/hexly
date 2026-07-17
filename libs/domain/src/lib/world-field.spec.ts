import {
  createWorldFieldRequestSchema,
  slugifyFieldSegment,
  updateWorldFieldRequestSchema,
  userDefinedFieldIdSchema,
  worldFieldIdFromSegment,
  worldFieldSchema,
} from './world-field';

const elementField = {
  id: 'world.element',
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

describe('slugifyFieldSegment / worldFieldIdFromSegment', () => {
  it('slugs a human label into a dash-collapsed, accent-folded key', () => {
    expect(slugifyFieldSegment('Élan Vital')).toBe('elan-vital');
    expect(slugifyFieldSegment('  Fire & Ice!  ')).toBe('fire-ice');
  });

  it('is idempotent — re-slugging an already-derived segment is a no-op', () => {
    expect(slugifyFieldSegment('elan-vital')).toBe('elan-vital');
  });

  it('prepends the reserved `world.` namespace to the slug', () => {
    expect(worldFieldIdFromSegment('Element')).toBe('world.element');
    expect(worldFieldIdFromSegment('elemental affinity')).toBe('world.elemental-affinity');
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
  it('takes a segment + Field body — never a client-chosen id or key (ADR-0056)', () => {
    const parsed = createWorldFieldRequestSchema.parse({
      segment: 'element',
      label: 'Element',
      dataType: { kind: 'enum', options: ['fire', 'ice', 'water'] },
      facetable: true,
    });
    expect(parsed).toEqual({
      segment: 'element',
      label: 'Element',
      dataType: { kind: 'enum', options: ['fire', 'ice', 'water'] },
      required: false,
      facetable: true,
    });
    // An id or key in the body is not part of the create contract — the server derives it.
    expect('key' in parsed).toBe(false);
    expect('id' in parsed).toBe(false);
  });

  it('requires a segment, a label, and a data-type', () => {
    expect(createWorldFieldRequestSchema.safeParse({ label: 'Element', dataType: { kind: 'string' } }).success).toBe(
      false,
    );
    expect(createWorldFieldRequestSchema.safeParse({ segment: 'element', label: 'Element' }).success).toBe(false);
  });

  it('rejects a segment that slugs to nothing (no derivable key)', () => {
    expect(
      createWorldFieldRequestSchema.safeParse({ segment: '!!!', label: 'X', dataType: { kind: 'string' } }).success,
    ).toBe(false);
  });
});

describe('updateWorldFieldRequestSchema', () => {
  it('takes the Field body wholesale, without a key or id (immutable, ADR-0056)', () => {
    const body = { label: 'Elemental affinity', dataType: { kind: 'string' as const } };
    expect(updateWorldFieldRequestSchema.parse(body)).toEqual({ ...body, required: false, facetable: false });
    // A key or id sent by a stale client is stripped, never applied — the id is a path param.
    expect('key' in updateWorldFieldRequestSchema.parse({ ...body, key: 'sneaky' })).toBe(false);
  });

  it('rejects a body missing its label or data-type', () => {
    expect(updateWorldFieldRequestSchema.safeParse({ dataType: { kind: 'string' } }).success).toBe(false);
    expect(updateWorldFieldRequestSchema.safeParse({ label: 'Element' }).success).toBe(false);
  });
});
