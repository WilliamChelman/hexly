import {
  abilityModifier,
  DND_ABILITY_KEYS,
  DND_CHALLENGE_KEY,
  DND_DEFENCE_KEYS,
  DND_IDENTITY_KEYS,
  DND_STAT_BLOCK,
  DND_STAT_BLOCK_FIELD,
  DND_STAT_FIELDS,
  emptyStatBlock,
  formatModifier,
  STAT_BLOCK_DATA_TYPE,
  statBlockSchema,
} from './stat-block';

describe('dnd.stat-block data type', () => {
  it('is a structured Data Type whose Field is never directly facetable (ADR-0055)', () => {
    expect(STAT_BLOCK_DATA_TYPE.id).toBe(DND_STAT_BLOCK);
    expect(DND_STAT_BLOCK_FIELD.dataType).toEqual({ kind: DND_STAT_BLOCK });
    // The blob has no discrete values to count; its dimensions are harvested, not counted off a flag.
    expect(DND_STAT_BLOCK_FIELD.facetable).toBe(false);
    expect(DND_STAT_BLOCK_FIELD.required).toBe(false);
  });

  it('opens empty and projects to frontmatter (CONTEXT.md → Vault Projection)', () => {
    expect(emptyStatBlock()).toEqual({});
    expect(STAT_BLOCK_DATA_TYPE.vault?.slot).toBe('frontmatter');
  });

  it('declares exactly the three facet dimensions the retired scalar Fields carried', () => {
    expect(STAT_BLOCK_DATA_TYPE.facetDimensions?.map((d) => d.key)).toEqual([
      'size',
      'creature_type',
      'challenge_rating',
    ]);
    // CR is the one numeric dimension, so the rail offers it a range control (ADR-0055).
    const cr = STAT_BLOCK_DATA_TYPE.facetDimensions?.find((d) => d.key === DND_CHALLENGE_KEY);
    expect(cr?.dataType).toEqual({ kind: 'number' });
    // Every dimension carries an i18n labelKey — the read/label path renders it translated (ADR-0055).
    for (const dimension of STAT_BLOCK_DATA_TYPE.facetDimensions ?? [])
      expect(dimension.labelKey).toMatch(/^dnd\.statBlock\.facet\./);
  });

  it('harvests size, creature_type, and a numeric challenge_rating — never the ability scores', () => {
    const rows = STAT_BLOCK_DATA_TYPE.harvestFacets?.({
      size: 'Huge',
      creature_type: 'dragon',
      challenge_rating: 24,
      strength: 30,
      dexterity: 10,
    });

    expect(rows).toEqual([
      { key: 'size', value: 'Huge', num: null },
      { key: 'creature_type', value: 'dragon', num: null },
      // The numeric CR carries `num`, so a `cr >= 5` range compares it as a number (ADR-0055).
      { key: 'challenge_rating', value: '24', num: 24 },
    ]);
    // The six ability scores are stats, never facets: none leaks into the harvest.
    expect(rows?.some((r) => (DND_ABILITY_KEYS as readonly string[]).includes(r.key))).toBe(false);
  });

  it('harvests exactly one row per declared dimension when all are present — no declared-but-unharvested drift', () => {
    // A block carrying every declared dimension: the harvest must cover the declaration and no more, or a
    // dimension added to `facetDimensions` but not `harvestFacets` (or the reverse) would ship silently.
    const full = { size: 'Huge', creature_type: 'dragon', challenge_rating: 7 } as const;
    const harvestedKeys = STAT_BLOCK_DATA_TYPE.harvestFacets?.(full)
      .map((row) => row.key)
      .sort();
    const declaredKeys = STAT_BLOCK_DATA_TYPE.facetDimensions?.map((d) => d.key).sort();
    expect(harvestedKeys).toEqual(declaredKeys);
    // Every declared dimension is a real stat-block value key — the harvest reads it off the parsed block.
    const schemaKeys = Object.keys(statBlockSchema.shape);
    for (const dimension of STAT_BLOCK_DATA_TYPE.facetDimensions ?? []) expect(schemaKeys).toContain(dimension.key);
  });

  it('harvests a CR of 0 (a commoner is a real creature), and nothing from a value it cannot parse', () => {
    expect(STAT_BLOCK_DATA_TYPE.harvestFacets?.({ challenge_rating: 0 })).toEqual([
      { key: 'challenge_rating', value: '0', num: 0 },
    ]);
    // Forward-only: an at-rest value this build cannot read as a block harvests nothing rather than throwing.
    expect(STAT_BLOCK_DATA_TYPE.harvestFacets?.('not a block')).toEqual([]);
  });

  it('holds its value to the stat shapes, tolerating an absent stat (all optional)', () => {
    expect(statBlockSchema.safeParse({ challenge_rating: 5, size: 'Large' }).success).toBe(true);
    expect(statBlockSchema.safeParse({}).success).toBe(true);
    // A wrong data-type is rejected: a CR is a number, an unknown size is not one of the enum options.
    expect(statBlockSchema.safeParse({ challenge_rating: '5' }).success).toBe(false);
    expect(statBlockSchema.safeParse({ size: 'Enormous' }).success).toBe(false);
  });

  it('renders a descriptor for every stat the block prints, and prints every descriptor it declares', () => {
    const printed = [...DND_IDENTITY_KEYS, ...DND_DEFENCE_KEYS, ...DND_ABILITY_KEYS, DND_CHALLENGE_KEY];
    const declared = DND_STAT_FIELDS.map((field) => field.key);
    // Two-way pin: a stat schema/descriptor gained without a rendered slot — or a slot without a stat —
    // would silently drop from the only surface that edits it.
    expect([...declared].sort()).toEqual([...printed].sort());
    // No stat is required: requiredness is a consumer's concern, not one the reusable block imposes on a
    // deity that borrows it (ADR-0055). The View flags only an at-rest ill-typed value, never an absent one.
    expect(DND_STAT_FIELDS.some((field) => field.required)).toBe(false);
  });
});

describe('abilityModifier', () => {
  it('derives the printed modifier from a raw score', () => {
    expect(abilityModifier(10)).toBe(0);
    expect(abilityModifier(16)).toBe(3);
    expect(abilityModifier(8)).toBe(-1);
    expect(abilityModifier(1)).toBe(-5);
  });

  it('is blank for an absent or ill-typed score, never a bogus modifier (forward-only tolerance)', () => {
    expect(abilityModifier(undefined)).toBeNull();
    expect(abilityModifier('strong')).toBeNull();
    expect(abilityModifier(Number.NaN)).toBeNull();
  });

  it('prints a modifier signed, as a stat block does', () => {
    expect(formatModifier(3)).toBe('+3');
    expect(formatModifier(0)).toBe('+0');
    expect(formatModifier(-1)).toBe('-1');
  });
});
