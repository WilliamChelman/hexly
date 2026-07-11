/**
 * The `dnd.monster` bundled Plugin type (#192) — the first type with a **bespoke view**, proving a
 * compiled-in plugin can teach Hexly a whole game system through the same {@link defineType} the core
 * dogfoods.
 *
 * Namespaced (`dnd.`) so a future `pathfinder.monster` never collides. It adds **no payload**: a
 * monster is the `rich-content` base (its lore is its Content) plus a Field schema, so its stat block
 * lives entirely in the one Metadata map — which is why an instance *without* this plugin still opens
 * a monster fine, as rich content plus the generic Field view (CONTEXT.md → Field).
 */

import { FieldSchema } from '@hexly/domain';
import { defineType } from '../define-type';

/** The Entity Type id — the namespaced key an Entity carries in its `types[]`. */
export const DND_MONSTER = 'dnd.monster';

/**
 * The Metadata keys the stat block prints, grouped as it prints them — the identity line, the
 * defences, the abilities, and the Challenge Rating. The view resolves its rows from these rather
 * than re-typing the key strings, so renaming a Field here can't silently drop a row from the block.
 */
export const DND_IDENTITY_KEYS = ['size', 'creature_type', 'alignment'] as const;
export const DND_DEFENCE_KEYS = ['armor_class', 'hit_points', 'speed'] as const;
export const DND_CHALLENGE_KEY = 'challenge_rating';

/** The six ability scores, in the order a stat block prints them. Shared with the web's stat-block view. */
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
 * A D&D ability modifier: `floor((score - 10) / 2)` — the derived number a stat block prints beside
 * the raw score. Pure and shared so the view never re-invents the rule. `null` for an absent or
 * ill-typed score, which the view renders as a blank rather than a bogus `-5` (forward-only: a
 * monster at rest with garbage in `strength` still displays).
 */
export function abilityModifier(score: unknown): number | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return Math.floor((score - 10) / 2);
}

/** A modifier as a stat block prints it — always signed (`+3`, `-1`, `+0`). */
export function formatModifier(modifier: number): string {
  return modifier < 0 ? String(modifier) : `+${modifier}`;
}

const ABILITY_FIELDS: readonly FieldSchema[] = DND_ABILITY_KEYS.map((key) => ({
  key,
  label: DND_ABILITY_ABBREVIATIONS[key],
  dataType: { kind: 'number' } as const,
  required: false,
  facetable: false,
}));

/**
 * The bundled `dnd.monster` type. `challenge_rating` is the one **required** Field — the number a
 * worldbuilder filters and sorts by, so a monster without it is not yet a monster — and, with `size`
 * and `creature_type`, is **facetable**, unfolding in the Entity Browser's rail once `dnd.monster` is
 * the active Type filter (ADR-0035, #188).
 */
export const DND_MONSTER_TYPE = defineType({
  id: DND_MONSTER,
  label: 'Monster',
  fields: [
    {
      key: 'size',
      label: 'Size',
      dataType: { kind: 'enum', options: ['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'] },
      required: false,
      facetable: true,
    },
    {
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
    },
    { key: 'alignment', label: 'Alignment', dataType: { kind: 'string' }, required: false, facetable: false },
    { key: 'armor_class', label: 'Armor Class', dataType: { kind: 'number' }, required: false, facetable: false },
    { key: 'hit_points', label: 'Hit Points', dataType: { kind: 'number' }, required: false, facetable: false },
    { key: 'speed', label: 'Speed', dataType: { kind: 'string' }, required: false, facetable: false },
    ...ABILITY_FIELDS,
    {
      key: 'challenge_rating',
      label: 'Challenge Rating',
      dataType: { kind: 'number' },
      required: true,
      facetable: true,
    },
  ],
});
