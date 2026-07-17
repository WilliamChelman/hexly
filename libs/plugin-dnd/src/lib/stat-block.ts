/**
 * `dnd.stat-block` — the D&D stat block as a **Structured Data Type** (CONTEXT.md → Structured Data
 * Type, ADR-0055). The whole block is one value in the EntityDocument map; `dnd.monster` declares it at
 * the `stat_block` key beside its prose, and any type or Entity may attach the one Field to auto-afford
 * the stat-block View (ADR-0054).
 *
 * The first consumer of the harvest capability (#234/#235): it declares three `facetDimensions` and
 * emits their values per Entity, so collapsing the thirteen retired scalar Fields into one structured
 * value keeps `size`, `creature_type`, and `challenge_rating` on the Browser's facet rail. The six
 * ability scores stay non-facet stats inside the block.
 *
 * The framework-free half, which the API reads. The Angular half is `@hexly/plugin-dnd/web`.
 */

import {
  defineField,
  defineStructuredDataType,
  Field,
  FieldSchema,
  HarvestedFacet,
  StructuredDataTypeId,
} from '@hexly/domain';
import { z } from 'zod';

/** The `namespace.id` kind naming the stat-block data-type — what marks the `stat_block` Field structured. */
export const DND_STAT_BLOCK: StructuredDataTypeId = 'dnd.stat-block';

/** The stat-block Field's reuse handle (ADR-0054) — its `id`, distinct from the `stat_block` key it lenses. */
export const DND_STAT_BLOCK_FIELD_ID = 'dnd.stat_block';

/** The EntityDocument key the whole block projects to — nested under `stat_block:` in exported frontmatter (ADR-0055). */
export const DND_STAT_BLOCK_KEY = 'stat_block';

/** A creature's Size, in stat-block order — an `enum` dimension the Browser toggles values on. */
export const DND_SIZE_OPTIONS = ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'] as const;

/** A creature's type, the 5e set — an `enum` dimension the Browser toggles values on. */
export const DND_CREATURE_TYPE_OPTIONS = [
  'aberration',
  'beast',
  'celestial',
  'construct',
  'dragon',
  'elemental',
  'fey',
  'fiend',
  'giant',
  'humanoid',
  'monstrosity',
  'ooze',
  'plant',
  'undead',
] as const;

/**
 * The stat-block value's keys, grouped as the block prints them: identity, defences, the challenge
 * rating, and the six ability scores. `stat-block.spec.ts` pins these to the descriptor set below, so a
 * key that gains a schema entry without a rendered slot — or the reverse — is caught, not lost in silence.
 */
export const DND_IDENTITY_KEYS = ['size', 'creature_type', 'alignment'] as const;
export const DND_DEFENCE_KEYS = ['armor_class', 'hit_points', 'speed'] as const;
export const DND_CHALLENGE_KEY = 'challenge_rating';

/** The six ability scores, in the order a stat block prints them. */
export const DND_ABILITY_KEYS = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
] as const;

export type DndAbilityKey = (typeof DND_ABILITY_KEYS)[number];

/** The abbreviations a stat block prints above each ability score (STR, DEX, …). */
export const DND_ABILITY_ABBREVIATIONS: Readonly<Record<DndAbilityKey, string>> = {
  strength: 'STR',
  dexterity: 'DEX',
  constitution: 'CON',
  intelligence: 'INT',
  wisdom: 'WIS',
  charisma: 'CHA',
};

/**
 * The stat-block value (CONTEXT.md → Structured Data Type): the six ability scores plus defences,
 * identity, and challenge rating. Every field optional — requiredness is a monster-type concern the
 * View flags, not a shape the reusable block imposes on a deity that borrows it for its size facet
 * alone. Unknown keys are stripped by the parse, keeping the harvest and the facet index clean.
 */
export const statBlockSchema = z
  .object({
    strength: z.number().finite(),
    dexterity: z.number().finite(),
    constitution: z.number().finite(),
    intelligence: z.number().finite(),
    wisdom: z.number().finite(),
    charisma: z.number().finite(),
    armor_class: z.number().finite(),
    hit_points: z.number().finite(),
    speed: z.string(),
    alignment: z.string(),
    size: z.enum(DND_SIZE_OPTIONS),
    creature_type: z.enum(DND_CREATURE_TYPE_OPTIONS),
    challenge_rating: z.number().finite(),
  })
  .partial();

export type StatBlock = z.infer<typeof statBlockSchema>;

/** A fresh empty stat block — an untouched creature the first edit fills in (CONTEXT.md → Structured Data Type). */
export function emptyStatBlock(): StatBlock {
  return {};
}

/**
 * The stat-block data-type (ADR-0055). It harvests three **Facet** dimensions — `size` and
 * `creature_type` (enum), `challenge_rating` (number, so its `num` is populated and its range filter is
 * preserved) — matching the `facetable: true` set the retired scalar Fields carried. The ability scores
 * are never harvested: they are stats, not facets.
 *
 * It projects to **frontmatter** (CONTEXT.md → Vault Projection): the block rides the YAML as one nested
 * value the vault layer serializes and re-reads generically, so it round-trips with no `toMarkdown`.
 */
export const STAT_BLOCK_DATA_TYPE = defineStructuredDataType({
  id: DND_STAT_BLOCK,
  valueSchema: statBlockSchema,
  empty: emptyStatBlock,
  facetDimensions: [
    { key: 'size', labelKey: 'dnd.statBlock.facet.size', dataType: { kind: 'enum', options: [...DND_SIZE_OPTIONS] } },
    {
      key: 'creature_type',
      labelKey: 'dnd.statBlock.facet.creatureType',
      dataType: { kind: 'enum', options: [...DND_CREATURE_TYPE_OPTIONS] },
    },
    { key: DND_CHALLENGE_KEY, labelKey: 'dnd.statBlock.facet.challengeRating', dataType: { kind: 'number' } },
  ],
  harvestFacets: (block: StatBlock): HarvestedFacet[] => {
    const rows: HarvestedFacet[] = [];
    if (block.size) rows.push({ key: 'size', value: block.size, num: null });
    if (block.creature_type) rows.push({ key: 'creature_type', value: block.creature_type, num: null });
    // A CR of 0 is a legitimate creature (a commoner), so guard on the type, not on truthiness.
    if (typeof block.challenge_rating === 'number')
      rows.push({ key: DND_CHALLENGE_KEY, value: String(block.challenge_rating), num: block.challenge_rating });
    return rows;
  },
  vault: { slot: 'frontmatter' },
});

/**
 * The registered stat-block **Plugin Field** ({@link defineField}, ADR-0054) — the reuse handle a type
 * references (`dnd.monster`) or an Entity attaches. Not `required`: an absent block opens empty and the
 * first edit mints one. Never *directly* facetable — the blob has no discrete values to count; its Data
 * Type harvests the facet dimensions instead (ADR-0055). Its `labelKey` labels the View toggle a `{ field }`
 * placement affords.
 */
export const DND_STAT_BLOCK_FIELD: Field = defineField({
  id: DND_STAT_BLOCK_FIELD_ID,
  key: DND_STAT_BLOCK_KEY,
  // The untranslated fallback the API's available-fields list reports; the web resolves `labelKey`.
  label: 'Stat block',
  labelKey: 'dnd.monster.view.statBlock',
  dataType: { kind: DND_STAT_BLOCK },
  required: false,
  facetable: false,
});

/**
 * The per-stat rendering descriptors the {@link StatBlockView} edits through — a {@link FieldSchema} per
 * inner key, giving each stat its control type and label. Not registered Fields (the block's keys are not
 * top-level document keys), only a lens the View builds its slots and its type-check from. No stat is
 * `required`: requiredness is a consumer's concern, not a shape the reusable block imposes on a deity that
 * borrows it for its size facet alone (ADR-0055) — so the View flags only an at-rest ill-typed value.
 */
export const DND_STAT_FIELDS: readonly FieldSchema[] = [
  stat('size', 'Size', { kind: 'enum', options: [...DND_SIZE_OPTIONS] }),
  stat('creature_type', 'Creature type', { kind: 'enum', options: [...DND_CREATURE_TYPE_OPTIONS] }),
  stat('alignment', 'Alignment', { kind: 'string' }),
  stat('armor_class', 'Armor Class', { kind: 'number' }),
  stat('hit_points', 'Hit Points', { kind: 'number' }),
  stat('speed', 'Speed', { kind: 'string' }),
  ...DND_ABILITY_KEYS.map((key) => stat(key, DND_ABILITY_ABBREVIATIONS[key], { kind: 'number' })),
  stat(DND_CHALLENGE_KEY, 'Challenge Rating', { kind: 'number' }),
];

/** The stat descriptors by inner key, for the View to look one up as it walks a group's keys. */
export const DND_STAT_FIELDS_BY_KEY: ReadonlyMap<string, FieldSchema> = new Map(
  DND_STAT_FIELDS.map((field) => [field.key, field]),
);

/** One stat descriptor — a plain {@link FieldSchema}, never `facetable` (the harvest owns faceting, ADR-0055). */
function stat(key: string, label: string, dataType: FieldSchema['dataType'], required = false): FieldSchema {
  return { key, label, dataType, required, facetable: false };
}

/**
 * A D&D ability modifier: `floor((score - 10) / 2)`. `null` for an absent or ill-typed score, so
 * the view renders a blank rather than a bogus `-5`.
 */
export function abilityModifier(score: unknown): number | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return Math.floor((score - 10) / 2);
}

/** A modifier as a stat block prints it — always signed (`+3`, `-1`, `+0`). */
export function formatModifier(modifier: number): string {
  return modifier < 0 ? String(modifier) : `+${modifier}`;
}
