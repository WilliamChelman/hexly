import {
  DS_ABILITY_CATEGORY_OPTIONS,
  DS_ABILITY_TYPE_OPTIONS,
  DS_CHARACTERISTIC_KEYS,
  DS_CONDITION_OPTIONS,
  DS_DEFENCE_KEYS,
  DS_IDENTITY_KEYS,
  DS_MAP_KEYS,
  DS_SECTION_KEYS,
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
    // The action-economy defences #254 lands: numeric save/turns and a closed condition-immunity list.
    expect(statBlockSchema.safeParse({ save: 4, turns: 2 }).success).toBe(true);
    expect(statBlockSchema.safeParse({ condition_immunities: ['frightened', 'prone'] }).success).toBe(true);
  });

  it('rejects a mistyped save/turns or an out-of-set condition immunity (forward-only gate, #254)', () => {
    expect(statBlockSchema.safeParse({ save: 'high' }).success).toBe(false);
    expect(statBlockSchema.safeParse({ turns: 'two' }).success).toBe(false);
    // A condition outside the pinned Draw Steel set is rejected — the list is closed like movement.
    expect(statBlockSchema.safeParse({ condition_immunities: ['stunned'] }).success).toBe(false);
  });

  it('pins the condition-immunity vocabulary from ds.CONFIG source keys (#254)', () => {
    expect(DS_CONDITION_OPTIONS).toEqual([
      'bleeding',
      'dazed',
      'frightened',
      'grabbed',
      'prone',
      'restrained',
      'slowed',
      'taunted',
      'weakened',
    ]);
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

  it('accepts a well-formed passive Traits list and rejects a malformed trait shape (#245)', () => {
    // A trait is a name + its effect text; the empty list and a freshly-added blank trait both parse.
    expect(
      statBlockSchema.safeParse({ traits: [{ name: 'Crafty', effect: 'Ignores difficult terrain.' }] }).success,
    ).toBe(true);
    expect(statBlockSchema.safeParse({ traits: [] }).success).toBe(true);
    expect(statBlockSchema.safeParse({ traits: [{ name: '', effect: '' }] }).success).toBe(true);
    // A malformed trait — a non-string field, a missing field, or a bare string where a record belongs.
    expect(statBlockSchema.safeParse({ traits: [{ name: 5, effect: 'x' }] }).success).toBe(false);
    expect(statBlockSchema.safeParse({ traits: [{ name: 'Crafty' }] }).success).toBe(false);
    expect(statBlockSchema.safeParse({ traits: ['Crafty'] }).success).toBe(false);
    // Unknown keys inside a trait are stripped, mirroring the block itself.
    expect(statBlockSchema.parse({ traits: [{ name: 'Crafty', effect: 'x', extra: true }] })).toEqual({
      traits: [{ name: 'Crafty', effect: 'x' }],
    });
  });

  it('accepts an Ability with and without a power roll, and rejects a malformed ability/tier shape (#246)', () => {
    // A rolling ability: type + display distance/target + its three flat tier texts.
    expect(
      statBlockSchema.safeParse({
        abilities: [
          {
            name: 'Cleave',
            type: 'main',
            category: 'signature',
            keywords: ['melee', 'weapon'],
            distance: 'Melee 1',
            target: 'One creature',
            powerRoll: { characteristic: 'might', t1: '2 damage', t2: '5 damage', t3: '8 damage; push 1' },
          },
        ],
      }).success,
    ).toBe(true);
    // An effect-only ability (no power roll) is equally well-formed, and a triggered one may carry a trigger.
    expect(
      statBlockSchema.safeParse({
        abilities: [
          {
            name: 'Watchful',
            type: 'triggered',
            keywords: [],
            distance: 'Self',
            target: 'Self',
            trigger: 'An enemy moves adjacent',
            effect: 'The creature shifts 1.',
          },
        ],
      }).success,
    ).toBe(true);
    // The empty list and a freshly-added blank ability (blank strings, a valid default type) both parse.
    expect(statBlockSchema.safeParse({ abilities: [] }).success).toBe(true);
    expect(
      statBlockSchema.safeParse({ abilities: [{ name: '', type: 'main', keywords: [], distance: '', target: '' }] })
        .success,
    ).toBe(true);
    // A malformed ability — an out-of-set type, a missing required field, or a bare string where a record belongs.
    expect(
      statBlockSchema.safeParse({
        abilities: [{ name: 'X', type: 'ultimate', keywords: [], distance: '', target: '' }],
      }).success,
    ).toBe(false);
    expect(
      statBlockSchema.safeParse({ abilities: [{ name: 'X', keywords: [], distance: '', target: '' }] }).success,
    ).toBe(false);
    expect(statBlockSchema.safeParse({ abilities: ['Cleave'] }).success).toBe(false);
    // A malformed tier shape — a non-string tier, a bad characteristic, or a missing tier — is rejected.
    expect(
      statBlockSchema.safeParse({
        abilities: [
          {
            name: 'X',
            type: 'main',
            keywords: [],
            distance: '',
            target: '',
            powerRoll: { characteristic: 'might', t1: 1, t2: 'a', t3: 'b' },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      statBlockSchema.safeParse({
        abilities: [
          {
            name: 'X',
            type: 'main',
            keywords: [],
            distance: '',
            target: '',
            powerRoll: { characteristic: 'luck', t1: 'a', t2: 'b', t3: 'c' },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      statBlockSchema.safeParse({
        abilities: [
          {
            name: 'X',
            type: 'main',
            keywords: [],
            distance: '',
            target: '',
            powerRoll: { characteristic: 'might', t1: 'a', t2: 'b' },
          },
        ],
      }).success,
    ).toBe(false);
    // Unknown keys inside an ability are stripped, mirroring the block itself.
    expect(
      statBlockSchema.parse({
        abilities: [{ name: 'Cleave', type: 'main', keywords: [], distance: '', target: '', extra: true }],
      }),
    ).toEqual({ abilities: [{ name: 'Cleave', type: 'main', keywords: [], distance: '', target: '' }] });
  });

  it('pins the ability-type enum from ds.CONFIG source keys (#246)', () => {
    expect(DS_ABILITY_TYPE_OPTIONS).toEqual([
      'main',
      'maneuver',
      'freeManeuver',
      'triggered',
      'freeTriggered',
      'move',
      'none',
      'villain',
    ]);
  });

  it('carries an optional numeric malice and an ability category distinct from type (#254)', () => {
    // A villain action spending 3 Malice, categorised — both optional slots, distinct from `type`.
    expect(
      statBlockSchema.safeParse({
        abilities: [
          { name: 'Doom', type: 'villain', category: 'villain', malice: 3, keywords: [], distance: '', target: '' },
        ],
      }).success,
    ).toBe(true);
    // Malice is a number, not the old free-text cost string — a string is rejected by the forward-only gate.
    expect(
      statBlockSchema.safeParse({
        abilities: [{ name: 'X', type: 'main', malice: '3 Malice', keywords: [], distance: '', target: '' }],
      }).success,
    ).toBe(false);
    // Category is a closed enum — an out-of-set value is rejected.
    expect(
      statBlockSchema.safeParse({
        abilities: [{ name: 'X', type: 'main', category: 'ultimate', keywords: [], distance: '', target: '' }],
      }).success,
    ).toBe(false);
    // The retired `cost` string is an unknown key now — stripped, not carried into the ability.
    expect(
      statBlockSchema.parse({
        abilities: [{ name: 'X', type: 'main', cost: 'Signature', keywords: [], distance: '', target: '' }],
      }),
    ).toEqual({ abilities: [{ name: 'X', type: 'main', keywords: [], distance: '', target: '' }] });
  });

  it('pins the ability-category enum (#254)', () => {
    expect(DS_ABILITY_CATEGORY_OPTIONS).toEqual(['signature', 'heroic', 'villain', 'maliceAncestry']);
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

    // Every schema key is a flat descriptor, a damage map, or a list-of-record section — nothing unaccounted.
    const accounted = new Set<string>([...declared, ...DS_MAP_KEYS, ...DS_SECTION_KEYS]);
    expect(Object.keys(statBlockSchema.shape).sort()).toEqual([...accounted].sort());

    // No stat is required, and each carries a translatable labelKey under the plugin's stat namespace.
    expect(DS_STAT_FIELDS.some((field) => field.required)).toBe(false);
    for (const field of DS_STAT_FIELDS) expect(field.labelKey).toMatch(/^drawSteel\.statBlock\.stat\./);
  });
});
