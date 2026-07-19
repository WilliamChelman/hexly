import { describe, expect, it } from 'vitest';
import { DS_MONSTER, DS_STAT_BLOCK_KEY, statBlockSchema } from '@hexly/plugin-draw-steel';
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
    // The prose field is initialized empty; the block holds no `img`.
    expect(record?.document).toHaveProperty(CONTENT_FIELD.id);
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
