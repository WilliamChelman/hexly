import { describe, expect, it } from 'vitest';
import { Ability, abilitySchema, DS_MONSTER, DS_STAT_BLOCK_KEY, statBlockSchema } from '@hexly/plugin-draw-steel';
import { CONTENT_FIELD } from '@hexly/plugin-content';
import { AJAX_MONSTER_FIXTURE, fixtureFetchPort, GOBLIN_MONSTER_FIXTURE } from '../testing';
import { createMonstersImporter, MONSTERS_IMPORTER_ID, MONSTERS_REV, toMonsterRecord } from './monsters-importer';

/** The minimal Monsters transform (#257): straight-in scalar stats, art dropped, no abilities/traits/remap. */
describe('draw-steel monsters transform', () => {
  it('maps the straight-in scalar spine and produces a schema-valid stat block', () => {
    const record = toMonsterRecord(AJAX_MONSTER_FIXTURE);
    expect(record).not.toBeNull();

    expect(record?.name).toBe('Ajax the Invincible');
    expect(record?.sourceId).toBe('DZKCzrvXRPBUjUJf');
    expect(record?.types).toEqual([DS_MONSTER]);

    const block = record?.document[DS_STAT_BLOCK_KEY];
    expect(statBlockSchema.safeParse(block).success).toBe(true);
    expect(block).toMatchObject({
      might: 5,
      agility: 4,
      reason: 5,
      intuition: 5,
      presence: 4,
      level: 11,
      ev: 156,
      stamina: 700,
      stability: 2,
      speed: 7,
      free_strike: 11,
      keywords: ['humanoid', 'human'],
    });
  });

  it('drops the actor art — no img crosses into the Entity Document', () => {
    const record = toMonsterRecord(AJAX_MONSTER_FIXTURE);
    // Neither the top-level document nor the stat block carries any art reference (ADR-0061).
    expect(JSON.stringify(record?.document)).not.toContain('img');
    expect(JSON.stringify(record?.document)).not.toContain('.webp');
  });

  it('keeps a 0 or negative characteristic but omits all-zero damage maps', () => {
    const block = toMonsterRecord(GOBLIN_MONSTER_FIXTURE)?.document[DS_STAT_BLOCK_KEY] as Record<string, unknown>;
    // A -2 Might and a 0 Reason are legitimate values, not absences.
    expect(block['might']).toBe(-2);
    expect(block['reason']).toBe(0);
    expect(block['stability']).toBe(0);
    // Every damage entry was 0 (plus the source `all` bucket), so no immunity/weakness map is emitted.
    expect(block).not.toHaveProperty('immunities');
    expect(block).not.toHaveProperty('weaknesses');
  });

  it('keeps only nonzero, known-typed damage entries and drops the source `all` bucket', () => {
    const block = toMonsterRecord({
      name: 'Cinder',
      type: 'npc',
      _id: 'x1',
      system: { damage: { immunities: { all: 3, fire: 5, cold: 0, unknownType: 9 } } },
    })?.document[DS_STAT_BLOCK_KEY];
    // `fire: 5` survives; `all` and `unknownType` (not a damage type) and the `cold: 0` are dropped.
    expect(block).toMatchObject({ immunities: { fire: 5 } });
    expect((block as { immunities: Record<string, unknown> }).immunities).not.toHaveProperty('all');
    expect((block as { immunities: Record<string, unknown> }).immunities).not.toHaveProperty('cold');
  });

  it('rejects a non-npc or unparseable document', () => {
    expect(toMonsterRecord({ type: 'character', name: 'Hero' })).toBeNull();
    expect(toMonsterRecord('not an object')).toBeNull();
    expect(toMonsterRecord(null)).toBeNull();
  });

  it('produce() serves the fixture pack through the fetch port with the pinned rev', async () => {
    const importer = createMonstersImporter(fixtureFetchPort());
    const production = await importer.produce({});

    expect(importer.id).toBe(MONSTERS_IMPORTER_ID);
    expect(production.rev).toBe(MONSTERS_REV);
    expect(production.records.map((r) => r.name)).toEqual(['Ajax the Invincible', 'Goblin Warrior']);
  });

  it('surfaces a fetch failure as a rejected produce (→ failed run)', async () => {
    const importer = createMonstersImporter({
      fetchMonsters: async () => {
        throw new Error('boom');
      },
    });
    await expect(importer.produce({})).rejects.toThrow('boom');
  });
});

/** The structural, non-ability mapping (#258): size, movement, role/org remap, conditions, traits, prose. */
describe('draw-steel monsters transform — structural mapping', () => {
  const ajax = () => toMonsterRecord(AJAX_MONSTER_FIXTURE)?.document[DS_STAT_BLOCK_KEY] as Record<string, unknown>;
  const goblin = () => toMonsterRecord(GOBLIN_MONSTER_FIXTURE)?.document[DS_STAT_BLOCK_KEY] as Record<string, unknown>;

  it('composes the size token from value + letter, bare number at value ≥ 2', () => {
    expect(ajax()['size']).toBe('1L');
    expect(goblin()['size']).toBe('1S');
    const giant = toMonsterRecord({
      type: 'npc',
      _id: 'g1',
      name: 'Giant',
      system: { combat: { size: { value: 3, letter: '' } } },
    })?.document[DS_STAT_BLOCK_KEY] as Record<string, unknown>;
    expect(giant['size']).toBe('3');
  });

  it('lists movement types with walk filtered and hover folded in', () => {
    // Ajax flies and hovers; walk drops, the hover bool becomes a type.
    expect(ajax()['movement_types']).toEqual(['fly', 'hover']);
    // Goblin walks and climbs, no hover; only climb survives.
    expect(goblin()['movement_types']).toEqual(['climb']);
  });

  it('routes an organization-token role to organization, so Ajax reads as a Solo', () => {
    // Ajax's source `role` is `solo` — an organization, not a role: it must not land on `role`.
    expect(ajax()).not.toHaveProperty('role');
    expect(ajax()['organization']).toBe('solo');
    // Goblin has a genuine role and a genuine organization.
    expect(goblin()['role']).toBe('harrier');
    expect(goblin()['organization']).toBe('horde');
  });

  it('captures condition immunities where present, filtering unknown tokens', () => {
    // Absent across today's pack, so Ajax carries none…
    expect(ajax()).not.toHaveProperty('condition_immunities');
    // …but the `statuses.immunities` set is honoured (and pruned to known tokens) when a monster has them.
    const warded = toMonsterRecord({
      type: 'npc',
      _id: 'w1',
      name: 'Warded',
      system: { statuses: { immunities: ['frightened', 'bleeding', 'notacondition'] } },
    })?.document[DS_STAT_BLOCK_KEY] as Record<string, unknown>;
    expect(warded['condition_immunities']).toEqual(['frightened', 'bleeding']);
  });

  it('folds feature items into traits, resolving enricher tokens and director notes', () => {
    const traits = ajax()['traits'] as { name: string; effect: string }[];
    // Only the three `feature` items become traits; the `ability` item is not read this pass.
    expect(traits.map((t) => t.name)).toEqual(['Ajax', "I'm Not Done Yet.", 'Tactical Stance']);
    // The labelled damage enricher resolved to its label, with the paragraph break kept.
    expect(traits[0].effect).toContain('Ajax can take 20 damage to end');
    // The label-less `[[/apply bleeding]]` humanized to the bare condition.
    expect(traits[1].effect).toContain('Ajax is bleeding, he can choose');
    // The director note is folded onto the end of the trait's public prose.
    expect(traits[2].effect).toContain('Only one stance may be active at a time.');
    // No raw enricher token survives into any trait.
    expect(JSON.stringify(traits)).not.toMatch(/\[\[|\]\]/);
  });

  it('omits core.content for an empty biography, and folds a present one to prose', () => {
    // Ajax + Goblin both have empty biographies → no prose field at all.
    expect(toMonsterRecord(AJAX_MONSTER_FIXTURE)?.document).not.toHaveProperty(CONTENT_FIELD.id);
    expect(toMonsterRecord(GOBLIN_MONSTER_FIXTURE)?.document).not.toHaveProperty(CONTENT_FIELD.id);
    // A monster with a real biography carries a core.content whose prose round-trips.
    const record = toMonsterRecord({
      type: 'npc',
      _id: 'b1',
      name: 'Storied',
      system: { biography: { value: '<p>Once a hero, now a tyrant.</p>', director: 'Secretly repentant.' } },
    });
    const content = record?.document[CONTENT_FIELD.id];
    expect(content).toBeDefined();
    const text = JSON.stringify(content);
    expect(text).toContain('Once a hero, now a tyrant.');
    expect(text).toContain('Secretly repentant.');
  });

  it('starts the director note on its own paragraph even when the value has no trailing block tag', () => {
    const content = toMonsterRecord({
      type: 'npc',
      _id: 'b2',
      name: 'Bare',
      // A plain-text value with no closing `</p>` — the director note must still break to a new paragraph.
      system: { biography: { value: 'A quiet life.', director: 'Hidden agenda.' } },
    })?.document[CONTENT_FIELD.id] as { snapshot: { content: unknown[] } } | undefined;
    expect(content?.snapshot.content).toHaveLength(2);
  });
});

/** The ability transform (#259): abilities[] with composed distance/target/effect and multi-tier power rolls. */
describe('draw-steel monsters transform — abilities + power rolls', () => {
  const ajaxAbilities = (): Ability[] =>
    (toMonsterRecord(AJAX_MONSTER_FIXTURE)?.document[DS_STAT_BLOCK_KEY] as { abilities: Ability[] }).abilities;
  const goblinAbilities = (): Ability[] =>
    (toMonsterRecord(GOBLIN_MONSTER_FIXTURE)?.document[DS_STAT_BLOCK_KEY] as { abilities: Ability[] }).abilities;
  const byName = (abilities: Ability[], name: string): Ability => {
    const found = abilities.find((ability) => ability.name === name);
    if (!found) throw new Error(`no ability named ${name}`);
    return found;
  };

  it('imports Ajax faithfully — 16 abilities across all four categories, each schema-valid', () => {
    const abilities = ajaxAbilities();
    expect(abilities).toHaveLength(16);
    // Every ability is a well-formed stat-block Ability.
    for (const ability of abilities) expect(abilitySchema.safeParse(ability).success).toBe(true);
    // The four categories are all represented (the six uncategorized abilities carry no `category`).
    const categories = abilities.map((ability) => ability.category);
    expect(categories.filter((c) => c === 'signature')).toHaveLength(1);
    expect(categories.filter((c) => c === 'heroic')).toHaveLength(2);
    expect(categories.filter((c) => c === 'villain')).toHaveLength(3);
    expect(categories.filter((c) => c === 'maliceAncestry')).toHaveLength(4);
    expect(categories.filter((c) => c === undefined)).toHaveLength(6);
  });

  it('maps the signature ability field-by-field, composing distance/target and the multi-tier roll', () => {
    // Blade of the Gol King: a main-action signature strike whose power roll damages *and* saps Recoveries.
    expect(byName(ajaxAbilities(), 'Blade of the Gol King')).toEqual({
      name: 'Blade of the Gol King',
      type: 'main',
      category: 'signature',
      keywords: ['charge', 'magic', 'melee', 'strike', 'weapon'],
      distance: 'Melee 1',
      target: '2 creatures or objects',
      powerRoll: {
        characteristic: 'might',
        t1: '16 damage; M < 4 the target loses 1d3 Recoveries',
        t2: '22 damage; M < 5 the target loses 1d3 Recoveries',
        t3: '26 damage; M < 6 prone and the target loses 1d3 Recoveries',
      },
      // The base effect prose and the malice-spend option, both enricher-resolved.
      effect:
        'Ajax shifts up to 2 squares between striking each target.\n\n1d3 recovery loss\n\n' +
        '1 Malice: Ajax can strike one additional target for each Malice spent.',
    });
  });

  it('composes a tier from all four effect kinds — damage, forced movement, and an applied condition', () => {
    // Decree by the Jade Hand stacks holy damage, a Slide, and a hexed condition gated by potency in one tier.
    const decree = byName(ajaxAbilities(), 'Decree by the Jade Hand');
    expect(decree.distance).toBe('Cube 3 within 10');
    expect(decree.target).toBe('Each enemy and object in the area');
    expect(decree.powerRoll).toEqual({
      characteristic: 'might',
      t1: '11 Holy damage; Slide 2; P < 4 the target is hexed (save ends)',
      t2: '17 Holy damage; Slide 5; P < 5 the target is hexed (save ends)',
      t3: '21 Holy damage; Slide 8; P < 6 the target is hexed (save ends)',
    });
  });

  it('maps a heroic ability as a flat effect with its numeric malice cost, no power roll', () => {
    const bead = byName(ajaxAbilities(), 'Bead of Hell');
    expect(bead.category).toBe('heroic');
    expect(bead.malice).toBe(2);
    expect(bead.target).toBe('Special');
    expect(bead.powerRoll).toBeUndefined();
    expect(bead.effect).toContain('Each enemy in the area when the bead ignites takes 20 fire damage');
    // The label-less potency enricher resolved to its printed form inside the flat effect.
    expect(bead.effect).toContain('A < 5, they are dazed (save ends)');
  });

  it('carries the villain category and a triggered action with its trigger text', () => {
    const phoenix = byName(ajaxAbilities(), 'Phoenix Wing King');
    expect(phoenix).toMatchObject({ type: 'villain', category: 'villain', distance: 'Burst 5' });
    expect(phoenix.powerRoll?.t2).toBe('17 Fire damage; A < 5 weakened (save ends)');

    const triggered = byName(ajaxAbilities(), 'Is This What They Taught You?');
    expect(triggered.type).toBe('triggered');
    expect(triggered.trigger).toBe('A creature within distance marks Ajax.');
    expect(triggered.target).toBe('The triggering creature');
  });

  it('reads a reactive roll as printed — inverted tiers, no derived-data inheritance', () => {
    // Draw Steel is a reactive malice-ancestry action: its tiers descend (26→16) and empty tiers do not inherit.
    const drawSteel = byName(ajaxAbilities(), 'Draw Steel');
    expect(drawSteel).toMatchObject({ category: 'maliceAncestry', malice: 10 });
    expect(drawSteel.powerRoll).toEqual({
      characteristic: 'might',
      t1: '26 damage; bleeding and slowed (save ends)',
      t2: '22 damage; bleeding (save ends)',
      t3: '16 damage',
    });
  });

  it('leaks no raw enricher token into any imported ability', () => {
    expect(JSON.stringify(ajaxAbilities())).not.toMatch(/\[\[|\]\]|\{\{|@chr/);
  });

  it('imports a Goblin family, resolving applied-condition tiers through the monster potency', () => {
    const abilities = goblinAbilities();
    expect(abilities).toHaveLength(5);

    // Spear Charge: a signature strike whose power roll rolls off Agility, damage-only tiers.
    expect(byName(abilities, 'Spear Charge')).toMatchObject({
      category: 'signature',
      powerRoll: { characteristic: 'agility', t1: '3 damage', t2: '4 damage', t3: '5 damage' },
    });

    // Bury The Point: the applied bleeding condition's potency resolves against the Goblin's own potency
    // (highest characteristic 2 → weak 0 / average 1 / strong 2), and inherits its display across the tiers.
    expect(byName(abilities, 'Bury The Point').powerRoll).toEqual({
      characteristic: 'agility',
      t1: '5 damage; M < 0 bleeding (save ends)',
      t2: '6 damage; M < 1 bleeding (save ends)',
      t3: '7 damage; M < 2 bleeding (save ends)',
    });

    // Swamp Stink: a reactive malice action whose applied-condition tiers read as authored.
    expect(byName(abilities, 'Swamp Stink').powerRoll).toEqual({
      characteristic: 'might',
      t1: '5 Poison damage; the creature is weakened until the mist disappears.',
      t2: 'The creature is weakened until the mist disappears.',
      t3: 'No effect.',
    });

    // A malice ancestry action with no power roll folds to a flat effect with its cost.
    expect(byName(abilities, 'Goblin Mode')).toMatchObject({ category: 'maliceAncestry', malice: 3 });
    expect(byName(abilities, 'Goblin Mode').powerRoll).toBeUndefined();
  });
});
