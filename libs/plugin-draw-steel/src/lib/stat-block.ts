/**
 * `draw-steel.stat-block` — a Draw Steel creature's stat block as a **Structured Data Type**
 * (CONTEXT.md → Structured Data Type, ADR-0055). The whole block is one value in the EntityDocument
 * map; `draw-steel.monster` declares it at the `stat_block` key beside its prose, and any type or Entity
 * may attach the one Field to auto-afford the stat-block View (ADR-0054).
 *
 * This is the **numeric/identity half** only (#243, the "spine"): the five characteristics, the
 * defences/movement, and the identity block. Traits, abilities, and the facet harvest are deliberate
 * follow-ups (#242) — the shape is chosen so they graft on without a rewrite.
 *
 * The framework-free half, which the API reads. The Angular half is `@hexly/plugin-draw-steel/web`.
 */

import { defineField, defineStructuredDataType, Field, StructuredDataTypeId } from '@hexly/domain';
import { z } from 'zod';

/** The `namespace.id` kind naming the stat-block data-type — what marks the `draw-steel.stat_block` Field structured. */
export const DS_STAT_BLOCK: StructuredDataTypeId = 'draw-steel.stat-block';

/** The stat-block Field's namespaced identifier — its `id`, and (ADR-0056) the EntityDocument key it lenses. */
export const DS_STAT_BLOCK_FIELD_ID = 'draw-steel.stat_block';

/**
 * The EntityDocument key the whole block projects to — nested under `draw-steel.stat_block:` in exported
 * frontmatter (ADR-0055). Equal to the Field's `id` (ADR-0056): a Field has one namespaced identifier
 * that is the slot it lenses.
 */
export const DS_STAT_BLOCK_KEY = DS_STAT_BLOCK_FIELD_ID;

/**
 * The enum vocabularies, pinned from the Draw Steel repo's `ds.CONFIG` (branch `1.1.x`) so the values
 * match the Foundry pack-source a later importer reads (#242). Kept as lowercase source keys, mirroring
 * `dnd`'s `DND_CREATURE_TYPE_OPTIONS` — the View shows them raw, an import maps them one-to-one.
 */

/** A creature's tactical role — an `enum` stat. `leader`/`solo` are organizations in `ds.CONFIG`, not roles. */
export const DS_ROLE_OPTIONS = [
  'ambusher',
  'artillery',
  'brute',
  'controller',
  'defender',
  'harrier',
  'hexer',
  'mount',
  'support',
] as const;

/** How a creature fields in an encounter — an `enum` stat. */
export const DS_ORGANIZATION_OPTIONS = ['minion', 'horde', 'platoon', 'elite', 'leader', 'solo'] as const;

/** The movement kinds `speed` may apply to — the item type of the `movement_types` list. */
export const DS_MOVEMENT_TYPE_OPTIONS = ['walk', 'climb', 'fly', 'burrow', 'swim', 'teleport'] as const;

/** The damage types a creature may be immune or weak to — the keys of the `immunities`/`weaknesses` maps. */
export const DS_DAMAGE_TYPE_OPTIONS = [
  'acid',
  'cold',
  'corruption',
  'fire',
  'holy',
  'lightning',
  'poison',
  'psychic',
  'sonic',
] as const;

export type DsDamageType = (typeof DS_DAMAGE_TYPE_OPTIONS)[number];

/** The five characteristics, in the order a stat block prints them. */
export const DS_CHARACTERISTIC_KEYS = ['might', 'agility', 'reason', 'intuition', 'presence'] as const;

export type DsCharacteristicKey = (typeof DS_CHARACTERISTIC_KEYS)[number];

/** The single-letter abbreviations a stat block prints above each characteristic (M, A, R, I, P). */
export const DS_CHARACTERISTIC_ABBREVIATIONS: Readonly<Record<DsCharacteristicKey, string>> = {
  might: 'M',
  agility: 'A',
  reason: 'R',
  intuition: 'I',
  presence: 'P',
};

/**
 * The identity stats, in the order the View lays them out, and the defence/movement stats. The two
 * damage maps (`immunities`, `weaknesses`) sit apart in {@link DS_MAP_KEYS} — they are nested records,
 * not flat scalar slots. `stat-block.spec.ts` pins these against the schema, so a key that gains a
 * schema entry without a rendered slot — or the reverse — is caught, not lost in silence.
 */
export const DS_IDENTITY_KEYS = ['level', 'role', 'organization', 'ev', 'keywords', 'size'] as const;
export const DS_DEFENCE_KEYS = [
  'stamina',
  'stability',
  'save_threshold',
  'speed',
  'free_strike',
  'movement_types',
] as const;

/** The two per-damage-type maps — rendered as their own sections, never flat slots. */
export const DS_MAP_KEYS = ['immunities', 'weaknesses'] as const;

/** A per-damage-type number map (e.g. `{ fire: 5, cold: 3 }`) — every damage type optional. */
const damageMapSchema = z.partialRecord(z.enum(DS_DAMAGE_TYPE_OPTIONS), z.number().finite());

export type DamageMap = z.infer<typeof damageMapSchema>;

/**
 * The stat-block value (CONTEXT.md → Structured Data Type): the five characteristics plus the
 * defence/movement block and the identity block. Every field optional — requiredness is a
 * monster-type/View concern, not a shape the reusable block imposes on a consumer borrowing it for one
 * stat. Unknown keys are stripped by the parse.
 */
export const statBlockSchema = z
  .object({
    // Characteristics.
    might: z.number().finite(),
    agility: z.number().finite(),
    reason: z.number().finite(),
    intuition: z.number().finite(),
    presence: z.number().finite(),
    // Defences / movement.
    stamina: z.number().finite(),
    // Draw Steel size is a printed token (`1S`, `1M`, `1L`, `2`, …), not a closed enum.
    size: z.string(),
    stability: z.number().finite(),
    save_threshold: z.number().finite(),
    speed: z.number().finite(),
    movement_types: z.array(z.enum(DS_MOVEMENT_TYPE_OPTIONS)),
    free_strike: z.number().finite(),
    immunities: damageMapSchema,
    weaknesses: damageMapSchema,
    // Identity.
    role: z.enum(DS_ROLE_OPTIONS),
    organization: z.enum(DS_ORGANIZATION_OPTIONS),
    level: z.number().finite(),
    ev: z.number().finite(),
    keywords: z.array(z.string()),
  })
  .partial();

export type StatBlock = z.infer<typeof statBlockSchema>;

/** A fresh empty stat block — an untouched creature the first edit fills in (CONTEXT.md → Structured Data Type). */
export function emptyStatBlock(): StatBlock {
  return {};
}

/**
 * The stat-block data-type (ADR-0055). This first pass harvests **no** facets (that lands with the
 * Browser filters in #242) — it is a pure grouped value. It projects to **frontmatter** (CONTEXT.md →
 * Vault Projection): the block rides the YAML as one nested value the vault layer serializes and re-reads
 * generically, so it round-trips with no `toMarkdown`.
 */
export const STAT_BLOCK_DATA_TYPE = defineStructuredDataType({
  id: DS_STAT_BLOCK,
  valueSchema: statBlockSchema,
  empty: emptyStatBlock,
  vault: { slot: 'frontmatter' },
});

/**
 * The registered stat-block **Plugin Field** ({@link defineField}, ADR-0054) — the reuse handle a type
 * references (`draw-steel.monster`) or an Entity attaches. Not `required`: an absent block opens empty and
 * the first edit mints one. Never *directly* facetable — the blob has no discrete values to count
 * (ADR-0055). Its `labelKey` labels the View toggle a `{ field }` placement affords.
 */
export const DS_STAT_BLOCK_FIELD: Field = defineField({
  id: DS_STAT_BLOCK_FIELD_ID,
  // The untranslated fallback the API's available-fields list reports; the web resolves `labelKey`.
  label: 'Stat block',
  // The web resolves this under the `drawSteel` scope — transloco camel-cases the `draw-steel` namespace.
  labelKey: 'drawSteel.monster.view.statBlock',
  dataType: { kind: DS_STAT_BLOCK },
  required: false,
  facetable: false,
});

/**
 * The per-stat rendering descriptors the stat-block View edits through — a {@link Field} per flat inner
 * key, giving each stat its control type, an English `label` fallback, and a `labelKey` the web
 * translates (the reusable block honours the Locale, unlike `dnd`'s English-only slots). Not registered
 * Fields (the block's inner keys are not top-level document keys), only a lens the View builds its slots
 * from — so each descriptor's `id` is the inner block key it lenses. The two damage maps are absent here:
 * they render as their own sections, keyed by {@link DS_DAMAGE_TYPE_OPTIONS}.
 */
export const DS_STAT_FIELDS: readonly Field[] = [
  // Identity.
  stat('level', 'Level', { kind: 'number' }),
  stat('role', 'Role', { kind: 'enum', options: [...DS_ROLE_OPTIONS] }),
  stat('organization', 'Organization', { kind: 'enum', options: [...DS_ORGANIZATION_OPTIONS] }),
  stat('ev', 'EV', { kind: 'number' }),
  stat('keywords', 'Keywords', { kind: 'list', of: { kind: 'string' } }),
  stat('size', 'Size', { kind: 'string' }),
  // Defences / movement.
  stat('stamina', 'Stamina', { kind: 'number' }),
  stat('stability', 'Stability', { kind: 'number' }),
  stat('save_threshold', 'Save threshold', { kind: 'number' }),
  stat('speed', 'Speed', { kind: 'number' }),
  stat('free_strike', 'Free strike', { kind: 'number' }),
  stat('movement_types', 'Movement', { kind: 'list', of: { kind: 'enum', options: [...DS_MOVEMENT_TYPE_OPTIONS] } }),
  // Characteristics (the grid prints the abbreviation; this label is the row fallback / catalog anchor).
  ...DS_CHARACTERISTIC_KEYS.map((key) => stat(key, capitalize(key), { kind: 'number' })),
];

/** The stat descriptors by inner block key, for the View to look one up as it walks a group's keys. */
export const DS_STAT_FIELDS_BY_KEY: ReadonlyMap<string, Field> = new Map(
  DS_STAT_FIELDS.map((field) => [field.id, field]),
);

/**
 * One flat stat descriptor — a plain {@link Field} lensing an inner block key, never `facetable`. Its
 * `labelKey` (`drawSteel.statBlock.stat.<key>`) is the transloco key the View renders it under.
 */
function stat(id: string, label: string, dataType: Field['dataType']): Field {
  return { id, label, labelKey: `drawSteel.statBlock.stat.${id}`, dataType, required: false, facetable: false };
}

/** A stat's English fallback label — Title-cased from its inner key. */
function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
