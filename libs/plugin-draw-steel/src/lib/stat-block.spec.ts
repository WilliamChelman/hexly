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

  it('declares exactly the five identity facet dimensions the Browser filters Monsters by (#244)', () => {
    expect(STAT_BLOCK_DATA_TYPE.facetDimensions?.map((d) => d.key)).toEqual([
      'role',
      'organization',
      'level',
      'ev',
      'keywords',
    ]);
    // level and ev are numeric, so the rail offers each a range control (ADR-0055).
    const numericKeys = STAT_BLOCK_DATA_TYPE.facetDimensions
      ?.filter((d) => d.dataType.kind === 'number')
      .map((d) => d.key);
    expect(numericKeys).toEqual(['level', 'ev']);
    // Every dimension carries an i18n labelKey — the read/label path renders it translated (ADR-0055).
    for (const dimension of STAT_BLOCK_DATA_TYPE.facetDimensions ?? [])
      expect(dimension.labelKey).toMatch(/^drawSteel\.statBlock\.facet\./);
  });

  it('harvests role/organization as enum rows, level/ev as numeric rows, one row per keyword — never a stat', () => {
    const rows = STAT_BLOCK_DATA_TYPE.harvestFacets?.({
      role: 'brute',
      organization: 'elite',
      level: 3,
      ev: 12,
      keywords: ['undead', 'humanoid'],
      // Characteristics and stamina are stats, not identity — none may leak into the harvest.
      might: 2,
      stamina: 80,
      size: '2',
    });

    expect(rows).toEqual([
      { key: 'role', value: 'brute', num: null },
      { key: 'organization', value: 'elite', num: null },
      // Numeric dimensions carry `num`, so a `level >= 3` range compares them as numbers (ADR-0055).
      { key: 'level', value: '3', num: 3 },
      { key: 'ev', value: '12', num: 12 },
      // One harvested row per keyword — the rail toggles each distinct value.
      { key: 'keywords', value: 'undead', num: null },
      { key: 'keywords', value: 'humanoid', num: null },
    ]);
    // Characteristics, stamina, and size are never harvested — the rail stays about identity, not stats.
    expect(rows?.some((r) => (DS_CHARACTERISTIC_KEYS as readonly string[]).includes(r.key))).toBe(false);
    expect(rows?.some((r) => r.key === 'stamina' || r.key === 'size')).toBe(false);
  });

  it('harvests every declared dimension when present — no declared-but-unharvested drift, keys are real value keys', () => {
    // A block carrying each declared dimension: the harvested key set must cover the declaration and no
    // more, or a dimension added to `facetDimensions` but not `harvestFacets` (or the reverse) ships silently.
    const full = { role: 'brute', organization: 'solo', level: 1, ev: 8, keywords: ['dragon'] } as const;
    const harvestedKeys = [...new Set(STAT_BLOCK_DATA_TYPE.harvestFacets?.(full).map((row) => row.key))].sort();
    const declaredKeys = STAT_BLOCK_DATA_TYPE.facetDimensions?.map((d) => d.key).sort();
    expect(harvestedKeys).toEqual(declaredKeys);
    // Every declared dimension is a real stat-block value key — the harvest reads it off the parsed block.
    const schemaKeys = Object.keys(statBlockSchema.shape);
    for (const dimension of STAT_BLOCK_DATA_TYPE.facetDimensions ?? []) expect(schemaKeys).toContain(dimension.key);
  });

  it('harvests a level and an EV of 0 (a legitimate value), and nothing from a value it cannot parse', () => {
    // A `0` is a real value, so the harvest guards on the type, not on truthiness (edge tolerance, #244).
    expect(STAT_BLOCK_DATA_TYPE.harvestFacets?.({ level: 0, ev: 0 })).toEqual([
      { key: 'level', value: '0', num: 0 },
      { key: 'ev', value: '0', num: 0 },
    ]);
    // Forward-only: an at-rest value this build cannot read as a block harvests nothing rather than throwing.
    expect(STAT_BLOCK_DATA_TYPE.harvestFacets?.('not a block')).toEqual([]);
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
