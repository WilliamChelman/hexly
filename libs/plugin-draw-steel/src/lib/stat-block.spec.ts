import {
  DS_CHARACTERISTIC_KEYS,
  DS_DEFENCE_KEYS,
  DS_IDENTITY_KEYS,
  DS_MAP_KEYS,
  DS_STAT_BLOCK,
  DS_STAT_BLOCK_FIELD,
  DS_STAT_FIELDS,
  emptyStatBlock,
  STAT_BLOCK_DATA_TYPE,
  statBlockSchema,
} from './stat-block';

describe('draw-steel.stat-block data type', () => {
  it('is a structured Data Type whose Field is never directly facetable (ADR-0055)', () => {
    expect(STAT_BLOCK_DATA_TYPE.id).toBe(DS_STAT_BLOCK);
    expect(DS_STAT_BLOCK_FIELD.dataType).toEqual({ kind: DS_STAT_BLOCK });
    expect(DS_STAT_BLOCK_FIELD.facetable).toBe(false);
    expect(DS_STAT_BLOCK_FIELD.required).toBe(false);
  });

  it('opens empty and projects to frontmatter (CONTEXT.md → Vault Projection)', () => {
    expect(emptyStatBlock()).toEqual({});
    expect(STAT_BLOCK_DATA_TYPE.vault?.slot).toBe('frontmatter');
  });

  it('harvests no facets this pass — the block is a pure grouped value (#243)', () => {
    // Faceting (role/organization/level/ev/keywords) lands with the Browser filters in #242; the spine
    // ships the shape without a harvest, so nothing declares a dimension yet.
    expect(STAT_BLOCK_DATA_TYPE.facetDimensions).toBeUndefined();
    expect(STAT_BLOCK_DATA_TYPE.harvestFacets).toBeUndefined();
  });

  it('holds its value to the stat shapes, tolerating an absent stat (all optional)', () => {
    // A partial block and the empty block both inhabit the schema — requiredness is a consumer concern.
    expect(statBlockSchema.safeParse({ level: 3, role: 'brute', might: 2 }).success).toBe(true);
    expect(statBlockSchema.safeParse({}).success).toBe(true);
    // The damage maps and the movement list parse as nested/enum-checked values, and size as a token.
    expect(statBlockSchema.safeParse({ immunities: { fire: 5 }, movement_types: ['fly', 'climb'] }).success).toBe(true);
    expect(statBlockSchema.safeParse({ size: '1S' }).success).toBe(true);
  });

  it('rejects a mistyped stat — a string where a number belongs, an out-of-enum role (forward-only gate)', () => {
    expect(statBlockSchema.safeParse({ might: 'strong' }).success).toBe(false);
    expect(statBlockSchema.safeParse({ role: 'wizard' }).success).toBe(false);
    // The nested map holds numbers; a non-damage-type key or a non-number value is rejected.
    expect(statBlockSchema.safeParse({ immunities: { fire: 'lots' } }).success).toBe(false);
    // A movement type outside the pinned set is rejected — `walk` was dropped, `hover` added.
    expect(statBlockSchema.safeParse({ movement_types: ['walk'] }).success).toBe(false);
    // Size is a closed token set now, not free text.
    expect(statBlockSchema.safeParse({ size: '6' }).success).toBe(false);
  });

  it('strips an unknown top-level key rather than carrying it into the block', () => {
    const parsed = statBlockSchema.parse({ level: 2, made_up: true });
    expect(parsed).toEqual({ level: 2 });
  });

  it('renders a descriptor for every flat stat the block prints, and prints every descriptor it declares', () => {
    const printed = [...DS_IDENTITY_KEYS, ...DS_DEFENCE_KEYS, ...DS_CHARACTERISTIC_KEYS];
    const declared = DS_STAT_FIELDS.map((field) => field.id);
    // Two-way pin over the flat stats: a schema key gained without a rendered slot — or a slot without a
    // stat — would silently drop. The two damage maps render as sections, so they sit outside this set.
    expect([...declared].sort()).toEqual([...printed].sort());

    // Every schema key is either a flat descriptor or one of the two damage maps — nothing unaccounted.
    const accounted = new Set<string>([...declared, ...DS_MAP_KEYS]);
    expect(Object.keys(statBlockSchema.shape).sort()).toEqual([...accounted].sort());

    // No stat is required, and each carries a translatable labelKey under the plugin's stat namespace.
    expect(DS_STAT_FIELDS.some((field) => field.required)).toBe(false);
    for (const field of DS_STAT_FIELDS) expect(field.labelKey).toMatch(/^drawSteel\.statBlock\.stat\./);
  });
});
