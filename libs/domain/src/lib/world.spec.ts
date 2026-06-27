import {
  createWorldRequestSchema,
  worldRoleSchema,
  worldSchema,
} from './world';

describe('worldSchema', () => {
  it('describes a World container: id, name, ownerId (ADR-0024)', () => {
    // The Home Entity is the World's `is_home` Entity, not a column here.
    const world = { id: 'w1', name: 'Aldermoor', ownerId: 'u1' };

    expect(worldSchema.parse(world)).toEqual(world);
  });

  it('trims the name and rejects an empty or whitespace-only one', () => {
    // Reuses the same trimmed, non-empty rule Entity names use.
    expect(
      worldSchema.parse({ name: '  Aldermoor  ', id: 'w1', ownerId: 'u1' }).name,
    ).toBe('Aldermoor');
    expect(() =>
      worldSchema.parse({ name: '   ', id: 'w1', ownerId: 'u1' }),
    ).toThrow();
  });
});

describe('worldRoleSchema', () => {
  it('accepts the two named World roles and rejects anything else (ADR-0024)', () => {
    // Owner is not a member row (it lives on worlds.owner_id); members are Contributor or Viewer.
    expect(worldRoleSchema.parse('contributor')).toBe('contributor');
    expect(worldRoleSchema.parse('viewer')).toBe('viewer');
    expect(() => worldRoleSchema.parse('owner')).toThrow();
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
