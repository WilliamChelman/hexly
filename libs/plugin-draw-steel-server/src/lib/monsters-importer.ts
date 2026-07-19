/**
 * The `draw-steel.monsters` **Importer** (ADR-0060): the near-pure producer that fetches the pinned
 * *Monsters* pack through its injected {@link MonstersFetchPort} and transforms each actor into one
 * Import Record. The reconcile lands the Records and stamps their `hexly.source`; this module only
 * fetches and transforms, so it is trivially fixture-tested (ADR-0060).
 *
 * Deliberately **minimal** (#257): one Record per monster carrying the straight-in scalar stats — the
 * five characteristics, level, EV, stamina, stability, speed, keywords, free strike, and the per-type
 * damage immunities/weaknesses. No abilities, traits, prose conversion, or size/role/organization remap
 * yet — those need mapping and follow. The transform is where Creator-License compliance is *baked in*,
 * not left to a checklist (ADR-0061): the actor's art (`img`) is simply never read, so it cannot leak.
 */

import {
  DS_DAMAGE_TYPE_OPTIONS,
  DS_MONSTER,
  DS_STAT_BLOCK_KEY,
  DsDamageType,
  StatBlock,
} from '@hexly/plugin-draw-steel';
import { CONTENT_FIELD, emptyContent } from '@hexly/plugin-content';
import { ImportContext, Importer, ImportProduction, ImportRecord } from '@hexly/domain';
import { z } from 'zod';
import { MONSTERS_PINNED_SHA, MonstersFetchPort } from './monster-fetch-port';

/** This Importer's `namespace.id` — the `importer` an Import Source names, and its key in the registry. */
export const MONSTERS_IMPORTER_ID = 'draw-steel.monsters';

/** The Importer's human copy for the generic Imports panel (ADR-0060). */
export const MONSTERS_IMPORTER_LABEL = 'Draw Steel — Monsters';

/**
 * The pinned source revision every landed monster's Import Source carries (ADR-0060/0061): the commit
 * SHA the tarball reflects. A run resolves it once, and the reconcile stamps it into each Entity — so
 * "which revision is this bestiary?" is answerable, and a reimport at the same pin is a no-op diff.
 */
export const MONSTERS_REV = MONSTERS_PINNED_SHA;

/**
 * Build the `draw-steel.monsters` Importer over a fetch port (ADR-0060). The port is a constructor
 * dependency, not a `produce` argument, so the composition root wires the real
 * {@link githubTarballFetchPort} while a test wires {@link fixtureFetchPort} — the whole pipe is then
 * exercised offline.
 */
export function createMonstersImporter(port: MonstersFetchPort): Importer {
  return {
    id: MONSTERS_IMPORTER_ID,
    label: MONSTERS_IMPORTER_LABEL,
    async produce(ctx: ImportContext): Promise<ImportProduction> {
      const raw = await port.fetchMonsters(ctx);
      // A document the parse rejects (not an npc actor) is dropped here; a well-shaped one the reconcile
      // still validates for name/types, so an unnamed monster surfaces as a skip, not a silent loss.
      const records = raw.map(toMonsterRecord).filter((record): record is ImportRecord => record !== null);
      return { rev: MONSTERS_REV, records };
    },
  };
}

/** The subset of a Foundry npc actor `_source` this minimal transform reads — every stat optional and defensively parsed. */
const characteristicSchema = z.object({ value: z.number().finite() }).partial();
const damageRecordSchema = z.record(z.string(), z.number()).optional();

const rawMonsterSchema = z.object({
  _id: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  img: z.string().optional(), // read only to be *ignored* — art is dropped (ADR-0061); never copied into the document
  system: z
    .object({
      stamina: z.object({ max: z.number().finite() }).partial().optional(),
      characteristics: z
        .object({
          might: characteristicSchema,
          agility: characteristicSchema,
          reason: characteristicSchema,
          intuition: characteristicSchema,
          presence: characteristicSchema,
        })
        .partial()
        .optional(),
      combat: z.object({ stability: z.number().finite() }).partial().optional(),
      movement: z.object({ value: z.number().finite() }).partial().optional(),
      damage: z.object({ immunities: damageRecordSchema, weaknesses: damageRecordSchema }).partial().optional(),
      monster: z
        .object({
          freeStrike: z.number().finite(),
          keywords: z.array(z.string()),
          level: z.number().finite(),
        })
        .partial()
        .optional(),
      ev: z.number().finite(),
    })
    .partial()
    .optional(),
});

type RawMonster = z.infer<typeof rawMonsterSchema>;

/**
 * Transform one raw actor document into an Import Record, or `null` when it is not a parseable npc actor.
 * Maps the straight-in scalar stats into a {@link StatBlock} (the reusable structured value) and nothing
 * else this pass (#257). `img` is intentionally absent from the output — the actor's art never crosses
 * into the Entity Document (ADR-0061).
 */
export function toMonsterRecord(raw: unknown): ImportRecord | null {
  const parsed = rawMonsterSchema.safeParse(raw);
  if (!parsed.success) return null;
  const actor = parsed.data;
  if (actor.type && actor.type !== 'npc') return null;

  return {
    // The Foundry `_id` is the stable upstream key the reconcile upserts by; an unnamed actor still
    // yields a Record so the reconcile can tally it as a skip rather than lose it silently.
    sourceId: actor._id ?? '',
    name: actor.name ?? '',
    types: [DS_MONSTER],
    document: {
      [CONTENT_FIELD.id]: emptyContent(),
      [DS_STAT_BLOCK_KEY]: statBlockOf(actor),
    },
  };
}

/** The straight-in scalar stat fields (#257), each set only when present so the block stays minimal. */
function statBlockOf(actor: RawMonster): StatBlock {
  const system = actor.system ?? {};
  const characteristics = system.characteristics ?? {};
  const block: StatBlock = {};

  assignNumber(block, 'might', characteristics.might?.value);
  assignNumber(block, 'agility', characteristics.agility?.value);
  assignNumber(block, 'reason', characteristics.reason?.value);
  assignNumber(block, 'intuition', characteristics.intuition?.value);
  assignNumber(block, 'presence', characteristics.presence?.value);
  assignNumber(block, 'level', system.monster?.level);
  assignNumber(block, 'ev', system.ev);
  assignNumber(block, 'stamina', system.stamina?.max);
  assignNumber(block, 'stability', system.combat?.stability);
  assignNumber(block, 'speed', system.movement?.value);
  assignNumber(block, 'free_strike', system.monster?.freeStrike);

  const keywords = system.monster?.keywords;
  if (keywords && keywords.length > 0) block.keywords = [...keywords];

  const immunities = damageMap(system.damage?.immunities);
  if (immunities) block.immunities = immunities;
  const weaknesses = damageMap(system.damage?.weaknesses);
  if (weaknesses) block.weaknesses = weaknesses;

  return block;
}

/** Set a numeric stat only when it is a finite number — a `0` is a legitimate value, an absent one is omitted. */
function assignNumber(block: StatBlock, key: keyof StatBlock, value: number | undefined): void {
  if (typeof value === 'number' && Number.isFinite(value)) {
    (block as Record<string, unknown>)[key] = value;
  }
}

/**
 * A per-damage-type map from the source's `{ all, acid, cold, … }` block, keeping only the known damage
 * types with a nonzero value — the source's `all` bucket and every zero are dropped, so a monster with no
 * resistances contributes no map at all. Returns `undefined` when nothing survives.
 */
function damageMap(source: Record<string, number> | undefined): Partial<Record<DsDamageType, number>> | undefined {
  if (!source) return undefined;
  const map: Partial<Record<DsDamageType, number>> = {};
  for (const type of DS_DAMAGE_TYPE_OPTIONS) {
    const value = source[type];
    if (typeof value === 'number' && Number.isFinite(value) && value !== 0) map[type] = value;
  }
  return Object.keys(map).length > 0 ? map : undefined;
}
