import {
  createWorldRequestSchema,
  worldRoleSchema,
  worldSchema,
} from './world';

describe('worldSchema', () => {
  it('describes a World container: id, name, owners set (ADR-0037)', () => {
    // Ownership is a symmetric set (ADR-0037); the Home Entity is the World's
    // `is_home` Entity, not a column here.
    const world = { id: 'w1', name: 'Aldermoor', owners: ['u1', 'u2'] };

    expect(worldSchema.parse(world)).toEqual(world);
  });

  it('trims the name and rejects an empty or whitespace-only one', () => {
    // Reuses the same trimmed, non-empty rule Entity names use.
    expect(
      worldSchema.parse({ name: '  Aldermoor  ', id: 'w1', owners: ['u1'] }).name,
    ).toBe('Aldermoor');
    expect(() =>
      worldSchema.parse({ name: '   ', id: 'w1', owners: ['u1'] }),
    ).toThrow();
  });
});

describe('worldRoleSchema', () => {
  it('accepts owner and the two named roles below it (ADR-0037)', () => {
    // Owner is now a member row with role 'owner' (the ownership set); members
    // below it are Contributor or Viewer.
    expect(worldRoleSchema.parse('owner')).toBe('owner');
    expect(worldRoleSchema.parse('contributor')).toBe('contributor');
    expect(worldRoleSchema.parse('viewer')).toBe('viewer');
    expect(() => worldRoleSchema.parse('gm')).toThrow();
  });
});

describe('createWorldRequestSchema', () => {
  it('accepts a request that names the World, trimming and rejecting blanks', () => {
    expect(createWorldRequestSchema.parse({ name: '  Avalon  ' }).name).toBe(
      'Avalon',
    );
    expect(() => createWorldRequestSchema.parse({ name: '   ' })).toThrow();
  });
});
