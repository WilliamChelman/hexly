/**
 * `draw-steel.stat-block` — a Draw Steel creature's stat block as a **Structured Data Type**
 * (CONTEXT.md → Structured Data Type, ADR-0055). The whole block is one value in the EntityDocument
 * map; `draw-steel.monster` declares it at the `stat_block` key beside its prose, and any type or Entity
 * may attach the one Field to auto-afford the stat-block View (ADR-0054).
 *
 * This is the **numeric/identity half** (#243, the "spine") plus its **facet harvest** (#244): the five
 * characteristics, the defences/movement, and the identity block, which harvests five identity
 * dimensions onto the Browser's facet rail. Traits and abilities are a deliberate follow-up (#242) — the
 * shape is chosen so they graft on without a rewrite.
 *
 * The framework-free half, which the API reads. The Angular half is `@hexly/plugin-draw-steel/web`.
 */

import { defineField, defineStructuredDataType, Field, HarvestedFacet, StructuredDataTypeId } from '@hexly/domain';
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
export const DS_MOVEMENT_TYPE_OPTIONS = ['climb', 'swim', 'fly', 'burrow', 'hover', 'teleport'] as const;

/**
 * The printed size tokens a creature may carry — a closed set (`1T` tiny … `5`), so the View offers a
 * pick rather than free text. Draw Steel writes size as a token, not a number, hence a string enum.
 */
export const DS_SIZE_OPTIONS = ['1T', '1S', '1M', '1L', '2', '3', '4', '5'] as const;

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

/**
 * An Ability's action type — its slot in the turn economy. Pinned from `ds.CONFIG.abilityTypes` (the
 * Draw Steel repo, branch `1.1.x`) as its lowercase source keys, so an import maps one-to-one and the
 * View shows them raw. `main` is the printed "Main Action"; `none`/`move` round out the source set.
 */
export const DS_ABILITY_TYPE_OPTIONS = [
  'main',
  'maneuver',
  'freeManeuver',
  'triggered',
  'freeTriggered',
  'move',
  'none',
  'villain',
] as const;

export type DsAbilityType = (typeof DS_ABILITY_TYPE_OPTIONS)[number];

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
  'speed',
  'free_strike',
  'movement_types',
  // The minion captain bonus rides this block on the card, so it partitions here beside movement — a
  // free-text line (`+1 damage bonus to strikes`), rendered only for a `minion` organization.
  'with_captain',
] as const;

/** The two per-damage-type maps — rendered as their own sections, never flat slots. */
export const DS_MAP_KEYS = ['immunities', 'weaknesses'] as const;

/** List-of-record sections rendered below the stat grid, apart from the flat {@link DS_STAT_FIELDS} — `traits` (#245) then `abilities` (#246), in printed-card order. */
export const DS_SECTION_KEYS = ['traits', 'abilities'] as const;

/** A per-damage-type number map (e.g. `{ fire: 5, cold: 3 }`) — every damage type optional. */
const damageMapSchema = z.partialRecord(z.enum(DS_DAMAGE_TYPE_OPTIONS), z.number().finite());

export type DamageMap = z.infer<typeof damageMapSchema>;

/** A passive Trait — name + effect. Required strings (not `.partial()`) so a blank added trait is well-formed while a malformed shape is rejected (#245). */
export const traitSchema = z.object({
  name: z.string(),
  effect: z.string(),
});

export type Trait = z.infer<typeof traitSchema>;

/**
 * An Ability's **power roll** — render-faithful, not resolvable: a characteristic plus the three flat tier
 * texts a printed block reads (`t1` ≤11 / `t2` 12–16 / `t3` 17+). Hexly never rolls; the tiers are prose.
 * Required strings so a freshly-toggled power roll is well-formed, while a non-string tier is rejected (#246).
 */
export const powerRollSchema = z.object({
  characteristic: z.enum(DS_CHARACTERISTIC_KEYS),
  t1: z.string(),
  t2: z.string(),
  t3: z.string(),
});

export type PowerRoll = z.infer<typeof powerRollSchema>;

/**
 * An active **Ability** — a signature action, maneuver, or triggered/villain action. Render-faithful
 * structured data (#246): `distance`/`target` are display strings this pass, not typed geometry, and an
 * Ability either rolls (its {@link PowerRoll} three tiers) or states a flat `effect` — both optional, so a
 * malformed power roll is caught while an effect-only ability is equally well-formed. `name`/`distance`/
 * `target`/`keywords` are required (blank-tolerant, like {@link traitSchema}) so an added ability parses;
 * `cost`/`trigger` are absent until authored. `type` is a required enum from {@link DS_ABILITY_TYPE_OPTIONS}.
 */
export const abilitySchema = z.object({
  name: z.string(),
  type: z.enum(DS_ABILITY_TYPE_OPTIONS),
  cost: z.string().optional(),
  keywords: z.array(z.string()),
  distance: z.string(),
  target: z.string(),
  trigger: z.string().optional(),
  powerRoll: powerRollSchema.optional(),
  effect: z.string().optional(),
});

export type Ability = z.infer<typeof abilitySchema>;

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
    // Draw Steel writes size as a printed token; {@link DS_SIZE_OPTIONS} pins the closed set.
    size: z.enum(DS_SIZE_OPTIONS),
    stability: z.number().finite(),
    speed: z.number().finite(),
    movement_types: z.array(z.enum(DS_MOVEMENT_TYPE_OPTIONS)),
    free_strike: z.number().finite(),
    // Minion-only free text ("+1 damage bonus to strikes"); the View gates its render on `organization`.
    with_captain: z.string(),
    immunities: damageMapSchema,
    weaknesses: damageMapSchema,
    // Identity.
    role: z.enum(DS_ROLE_OPTIONS),
    organization: z.enum(DS_ORGANIZATION_OPTIONS),
    level: z.number().finite(),
    ev: z.number().finite(),
    keywords: z.array(z.string()),
    // Sections ({@link DS_SECTION_KEYS}).
    traits: z.array(traitSchema),
    abilities: z.array(abilitySchema),
  })
  .partial();

export type StatBlock = z.infer<typeof statBlockSchema>;

/** A fresh empty stat block — an untouched creature the first edit fills in (CONTEXT.md → Structured Data Type). */
export function emptyStatBlock(): StatBlock {
  return {};
}

/**
 * The stat-block data-type (ADR-0055). It harvests five **identity** Facet dimensions so a GM finds a
 * creature by what it *is* (#244): `role` and `organization` (enum), `level` and `ev` (number, so their
 * `num` is populated and the rail offers a range), and `keywords` (one harvested row per keyword the rail
 * toggles). Characteristics, stamina, and every other stat are **never** harvested — the rail stays about
 * identity, not raw stats.
 *
 * It projects to **frontmatter** (CONTEXT.md → Vault Projection): the block rides the YAML as one nested
 * value the vault layer serializes and re-reads generically, so it round-trips with no `toMarkdown`.
 */
export const STAT_BLOCK_DATA_TYPE = defineStructuredDataType({
  id: DS_STAT_BLOCK,
  valueSchema: statBlockSchema,
  empty: emptyStatBlock,
  facetDimensions: [
    {
      key: 'role',
      labelKey: 'drawSteel.statBlock.facet.role',
      dataType: { kind: 'enum', options: [...DS_ROLE_OPTIONS] },
    },
    {
      key: 'organization',
      labelKey: 'drawSteel.statBlock.facet.organization',
      dataType: { kind: 'enum', options: [...DS_ORGANIZATION_OPTIONS] },
    },
    { key: 'level', labelKey: 'drawSteel.statBlock.facet.level', dataType: { kind: 'number' } },
    { key: 'ev', labelKey: 'drawSteel.statBlock.facet.ev', dataType: { kind: 'number' } },
    // A list dimension: the harvest emits one row per keyword, and the rail picks value-toggles over them.
    {
      key: 'keywords',
      labelKey: 'drawSteel.statBlock.facet.keywords',
      dataType: { kind: 'list', of: { kind: 'string' } },
    },
  ],
  harvestFacets: (block: StatBlock): HarvestedFacet[] => {
    const rows: HarvestedFacet[] = [];
    if (block.role) rows.push({ key: 'role', value: block.role, num: null });
    if (block.organization) rows.push({ key: 'organization', value: block.organization, num: null });
    // A level or EV of 0 is a legitimate value, so guard on the type, not on truthiness (#244).
    if (typeof block.level === 'number') rows.push({ key: 'level', value: String(block.level), num: block.level });
    if (typeof block.ev === 'number') rows.push({ key: 'ev', value: String(block.ev), num: block.ev });
    // One row per keyword — the facet index counts each distinct keyword as its own toggle.
    for (const keyword of block.keywords ?? []) rows.push({ key: 'keywords', value: keyword, num: null });
    return rows;
  },
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
  stat('size', 'Size', { kind: 'enum', options: [...DS_SIZE_OPTIONS] }),
  // Defences / movement.
  stat('stamina', 'Stamina', { kind: 'number' }),
  stat('stability', 'Stability', { kind: 'number' }),
  stat('speed', 'Speed', { kind: 'number' }),
  stat('free_strike', 'Free strike', { kind: 'number' }),
  stat('movement_types', 'Movement', { kind: 'list', of: { kind: 'enum', options: [...DS_MOVEMENT_TYPE_OPTIONS] } }),
  stat('with_captain', 'With Captain', { kind: 'string' }),
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
