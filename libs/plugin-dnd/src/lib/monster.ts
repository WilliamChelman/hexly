/**
 * The `dnd.monster` bundled Plugin type (CONTEXT.md → Type Definition). A monster's stat block lives
 * in the EntityDocument map beside its prose, both Fields in the Entity's one body (ADR-0051).
 *
 * The framework-free half, which the API reads. The Angular half is `@hexly/plugin-dnd/web`.
 */

import { defineField, defineType, Field } from '@hexly/domain';
import { CONTENT_FIELD } from '@hexly/plugin-content';

/** The Entity Type id — the namespaced key an Entity carries in its `types[]`. */
export const DND_MONSTER = 'dnd.monster';

/**
 * The EntityDocument keys the stat block prints, grouped as it prints them. `monster.spec.ts` pins these
 * to the Field schema below: the view silently skips a key it can't resolve, so a renamed Field
 * would otherwise drop its row without a word.
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

/** One ability-score Field per key — a first-class **Plugin Field** (`defineField`, ADR-0054). */
const ABILITY_FIELDS: readonly Field[] = DND_ABILITY_KEYS.map((key) =>
  defineField({
    id: `dnd.${key}`,
    key,
    label: DND_ABILITY_ABBREVIATIONS[key],
    dataType: { kind: 'number' },
    required: false,
    facetable: false,
  }),
);

/** The `dnd.monster` stat-block Fields (`defineField`, ADR-0054) — each a `dnd.`-namespaced reuse handle over its EntityDocument key. */
export const DND_MONSTER_FIELDS: readonly Field[] = [
  defineField({
    id: 'dnd.size',
    key: 'size',
    label: 'Size',
    dataType: { kind: 'enum', options: ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'] },
    required: false,
    facetable: true,
  }),
  defineField({
    id: 'dnd.creature_type',
    key: 'creature_type',
    label: 'Creature type',
    dataType: {
      kind: 'enum',
      options: [
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
      ],
    },
    required: false,
    facetable: true,
  }),
  defineField({ id: 'dnd.alignment', key: 'alignment', label: 'Alignment', dataType: { kind: 'string' } }),
  defineField({ id: 'dnd.armor_class', key: 'armor_class', label: 'Armor Class', dataType: { kind: 'number' } }),
  defineField({ id: 'dnd.hit_points', key: 'hit_points', label: 'Hit Points', dataType: { kind: 'number' } }),
  defineField({ id: 'dnd.speed', key: 'speed', label: 'Speed', dataType: { kind: 'string' } }),
  ...ABILITY_FIELDS,
  defineField({
    id: `dnd.${DND_CHALLENGE_KEY}`,
    key: DND_CHALLENGE_KEY,
    label: 'Challenge Rating',
    dataType: { kind: 'number' },
    required: true,
    facetable: true,
  }),
];

/**
 * The bundled `dnd.monster` type. Facetable Fields unfold in the Entity Browser's rail once
 * `dnd.monster` is the active Type filter (ADR-0035). References its Fields — the prose `core.content`
 * beside the thirteen stats — by id (`fieldRefs`, ADR-0054); inline `fields` remain for the web.
 */
export const DND_MONSTER_TYPE = defineType({
  id: DND_MONSTER,
  label: 'Monster',
  fields: [CONTENT_FIELD, ...DND_MONSTER_FIELDS],
  fieldRefs: [CONTENT_FIELD.id, ...DND_MONSTER_FIELDS.map((field) => field.id)],
});
