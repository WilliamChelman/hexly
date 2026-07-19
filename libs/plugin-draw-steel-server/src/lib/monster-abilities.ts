/**
 * The Monsters importer's **ability transform** (#259) — the "Ajax bar". The one pure step that turns a
 * Foundry `ability` item into a stat-block {@link Ability}: the scalar/identity fields (type, category,
 * numeric malice, keywords), the composed `distance`/`target` display strings, the `trigger`, the flat
 * `effect`, and — the hard part — the multi-tier {@link PowerRoll}, whose three tier texts are re-composed
 * from the structured `power.effects` (damage / applied / other / forced) exactly as Foundry would render
 * them at display time, resolved through the one {@link foundryProseToText} converter so no `{{potency}}`/
 * `{{forced}}` token or raw HTML leaks (ADR-0060/0061).
 *
 * The Foundry system computes each effect's tier text from *derived* data — an empty tier inherits the
 * previous tier's display/damage (unless the roll is reactive), and a monster's `@potency.weak|average|
 * strong` resolves against its highest characteristic. This module replicates those two derivations so an
 * imported power roll reads as printed (≤11 / 12–16 / 17+), rather than deferring to a live Foundry pass.
 */

import {
  Ability,
  DS_ABILITY_CATEGORY_OPTIONS,
  DS_ABILITY_TYPE_OPTIONS,
  DS_CHARACTERISTIC_ABBREVIATIONS,
  DS_CHARACTERISTIC_KEYS,
  DsAbilityCategory,
  DsAbilityType,
  DsCharacteristicKey,
  PowerRoll,
} from '@hexly/plugin-draw-steel';
import { z } from 'zod';
import { foundryProseToText } from './foundry-prose';

/** The five characteristic scores the transform reads off the block — each optional, each the potency input. */
export type MonsterCharacteristics = Partial<Record<DsCharacteristicKey, number>>;

const KNOWN_ABILITY_TYPES = new Set<string>(DS_ABILITY_TYPE_OPTIONS);
const KNOWN_CATEGORIES = new Set<string>(DS_ABILITY_CATEGORY_OPTIONS);

/** A power-roll effect's per-tier data — every field optional, since the shape differs by effect type. */
const tierSchema = z
  .object({
    value: z.string(),
    types: z.array(z.string()),
    display: z.string(),
    movement: z.array(z.string()),
    distance: z.string(),
    properties: z.array(z.string()),
    potency: z.object({ value: z.string(), characteristic: z.string() }).partial(),
  })
  .partial();

const tiersSchema = z.object({ tier1: tierSchema, tier2: tierSchema, tier3: tierSchema }).partial();

/** One `power.effects` entry: its `type` (damage/applied/other/forced), sort order, and the tier bag under its type key. */
const powerEffectSchema = z
  .object({
    type: z.string(),
    sort: z.number(),
    damage: tiersSchema,
    applied: tiersSchema,
    other: tiersSchema,
    forced: tiersSchema,
  })
  .partial();

/** An ability-level `effects` entry — the `base`/`spend` prose that folds into the flat {@link Ability.effect}. */
const abilityEffectSchema = z
  .object({
    type: z.string(),
    sort: z.number(),
    description: z.string(),
    resource: z.object({ value: z.number() }).partial(),
  })
  .partial();

/** The subset of a Foundry `ability` item the transform reads — every field defensively optional. */
const abilityItemSchema = z
  .object({
    name: z.string(),
    type: z.string(),
    system: z
      .object({
        type: z.string(),
        category: z.string(),
        keywords: z.array(z.string()),
        distance: z
          .object({ type: z.string(), primary: z.string(), secondary: z.string(), tertiary: z.string() })
          .partial(),
        target: z.object({ type: z.string(), value: z.number().nullable(), custom: z.string() }).partial(),
        trigger: z.string(),
        resource: z.number().nullable(),
        power: z
          .object({
            roll: z.object({ characteristics: z.array(z.string()), reactive: z.boolean() }).partial(),
            effects: z.record(z.string(), powerEffectSchema),
          })
          .partial(),
        effects: z.record(z.string(), abilityEffectSchema),
      })
      .partial(),
  })
  .partial();

type AbilityItem = z.infer<typeof abilityItemSchema>;
type PowerEffect = z.infer<typeof powerEffectSchema>;

/** The three derived potency strengths a monster's power roll resolves `@potency.weak|average|strong` against. */
interface Potency {
  readonly weak: number;
  readonly average: number;
  readonly strong: number;
}

/**
 * The active abilities of a monster (#259): every `ability` item mapped to a stat-block {@link Ability}, in
 * source order. Non-ability items (the `feature` traits) are skipped here — they fold into `traits[]` apart.
 */
export function abilitiesOf(items: readonly unknown[] | undefined, characteristics: MonsterCharacteristics): Ability[] {
  const potency = monsterPotency(characteristics);
  const abilities: Ability[] = [];
  for (const raw of items ?? []) {
    const parsed = abilityItemSchema.safeParse(raw);
    if (parsed.success && parsed.data.type === 'ability') abilities.push(abilityOf(parsed.data, potency));
  }
  return abilities;
}

/** Map one parsed `ability` item to an {@link Ability} — optionals set only when authored, so no husk persists. */
function abilityOf(item: AbilityItem, potency: Potency): Ability {
  const system = item.system ?? {};
  const ability: Ability = {
    name: item.name ?? '',
    type: abilityType(system.type),
    keywords: [...(system.keywords ?? [])],
    distance: distanceLabel(system.distance),
    target: targetLabel(system.target),
  };

  if (system.category && KNOWN_CATEGORIES.has(system.category)) ability.category = system.category as DsAbilityCategory;
  // The heroic/villain/malice resource cost is the ability's `malice` — a `0` would be legitimate, so guard the type.
  if (typeof system.resource === 'number' && Number.isFinite(system.resource)) ability.malice = system.resource;

  const trigger = foundryProseToText(system.trigger ?? '');
  if (trigger) ability.trigger = trigger;

  const powerRoll = powerRollOf(system.power, potency);
  if (powerRoll) ability.powerRoll = powerRoll;

  const effect = abilityEffectText(system.effects);
  if (effect) ability.effect = effect;

  return ability;
}

/** The action-type enum, defaulting to `main` for the rare item with an unknown/absent type (the schema requires one). */
function abilityType(type: string | undefined): DsAbilityType {
  return type && KNOWN_ABILITY_TYPES.has(type) ? (type as DsAbilityType) : 'main';
}

/**
 * The composed distance display string (e.g. "Melee 1", "Ranged 5", "Cube 3 within 10"), mirroring the Draw
 * Steel system's `DistanceEmbed` format strings (pinned like the enum vocabularies). An area distance folds
 * its primary/secondary/tertiary formulas in; `special`/`self` print their bare label.
 */
function distanceLabel(distance: NonNullable<AbilityItem['system']>['distance']): string {
  if (!distance?.type) return '';
  const primary = distance.primary ?? '';
  const secondary = distance.secondary ?? '';
  const tertiary = distance.tertiary ?? '';
  switch (distance.type) {
    case 'melee':
      return `Melee ${primary}`;
    case 'ranged':
      return `Ranged ${primary}`;
    case 'meleeRanged':
      return `Melee ${primary} or ranged ${secondary}`;
    case 'aura':
      return `Aura ${primary}`;
    case 'burst':
      return `Burst ${primary}`;
    case 'cube':
      return `Cube ${primary} within ${secondary}`;
    case 'line':
      return `${primary} x ${secondary} line within ${tertiary}`;
    case 'wall':
      return `${primary} wall within ${secondary}`;
    case 'special':
      return 'Special';
    case 'self':
      return 'Self';
    default:
      return distance.type;
  }
}

/** An area/all target's label by type, mirroring the Draw Steel system's `Target.All*` localization. */
const TARGET_ALL: Readonly<Record<string, string>> = {
  creature: 'Each creature',
  object: 'Each object',
  creatureObject: 'Each creature and object',
  enemy: 'Each enemy',
  enemyObject: 'Each enemy or object',
  ally: 'Each ally',
  selfAlly: 'Self and each ally',
};

/** A value-less target with no `all` form — the fixed self/special labels, mirroring the system's localization. */
const TARGET_SINGULAR: Readonly<Record<string, string>> = {
  self: 'Self',
  selfOrAlly: 'Self or one ally',
  selfOrCreature: 'Self or one creature',
  selfAlly: 'Self and allies',
  special: 'Special',
};

/** The pluralized noun for a counted target (e.g. "2 creatures or objects"), mirroring the system's `*Embed` plurals. */
function targetCount(type: string, value: number): string | undefined {
  const plural = value !== 1;
  const noun: Record<string, string> = {
    creature: plural ? 'creatures' : 'creature',
    object: plural ? 'objects' : 'object',
    creatureObject: plural ? 'creatures or objects' : 'creature or object',
    enemy: plural ? 'enemies' : 'enemy',
    enemyObject: plural ? 'enemies or objects' : 'enemy or object',
    ally: plural ? 'allies' : 'ally',
  };
  if (noun[type]) return `${value} ${noun[type]}`;
  if (type === 'selfAlly') return plural ? `Self and ${value} allies` : `Self and ${value} ally`;
  return undefined;
}

/**
 * The composed target display string (#259): an explicit custom line wins; a value-less target reads its
 * area/all label; a counted target reads its pluralized noun. Mirrors the Draw Steel `formattedLabels.target`.
 */
function targetLabel(target: NonNullable<AbilityItem['system']>['target']): string {
  if (!target?.type) return '';
  if (target.custom) return target.custom;
  if (target.value == null) return TARGET_ALL[target.type] ?? TARGET_SINGULAR[target.type] ?? capitalize(target.type);
  return targetCount(target.type, target.value) ?? String(target.value);
}

/**
 * The multi-tier power roll (#259): the characteristic plus the three tier texts re-composed from the
 * structured `power.effects`, or `undefined` when the ability has no effects (a flat-effect ability). Each
 * tier joins every effect's rendered text with "; ", exactly as the Draw Steel `powerRollText` does.
 */
function powerRollOf(power: NonNullable<AbilityItem['system']>['power'], potency: Potency): PowerRoll | undefined {
  const effects = power?.effects;
  if (!effects || Object.keys(effects).length === 0) return undefined;

  const reactive = power?.roll?.reactive === true;
  // Foundry sorts effects by their `sort`; a stable sort keeps source (insertion) order on ties.
  const prepared = Object.values(effects)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map((effect) => prepareEffect(effect, reactive));

  const tier = (n: 1 | 2 | 3): string =>
    prepared
      .map((effect) => effectTierText(effect, n, potency))
      .filter((text) => text.length > 0)
      .join('; ');

  return {
    characteristic: pickCharacteristic(power?.roll?.characteristics),
    t1: tier(1),
    t2: tier(2),
    t3: tier(3),
  };
}

/** The roll's characteristic — the first listed one that is a real characteristic, defaulting to `might`. */
function pickCharacteristic(characteristics: string[] | undefined): DsCharacteristicKey {
  const found = (characteristics ?? []).find((key): key is DsCharacteristicKey =>
    (DS_CHARACTERISTIC_KEYS as readonly string[]).includes(key),
  );
  return found ?? 'might';
}

/** One power-roll effect's tiers, normalized: the type key plus the three derived tiers (missing tiers as `undefined`). */
interface PreparedEffect {
  readonly type: string;
  readonly tiers: readonly (ResolvedTier | undefined)[];
}

/** A single tier after Foundry's derivations — the fields the render reads, with inheritance already applied. */
interface ResolvedTier {
  readonly value: string;
  readonly types: readonly string[];
  readonly display: string;
  readonly movement: readonly string[];
  readonly distance: string;
  readonly properties: readonly string[];
  readonly potencyValue: string;
  readonly potencyCharacteristic: string;
}

/** The standard per-tier potency the schema defaults an empty potency value to (`weak`/`average`/`strong`). */
const DEFAULT_POTENCY_VALUE = ['', '@potency.weak', '@potency.average', '@potency.strong'] as const;

/**
 * Apply Foundry's derived-data rules to an effect's three tiers so the render matches a live sheet: an empty
 * potency value defaults to the tier's standard strength; an empty potency characteristic and (for a
 * non-reactive roll) an empty display/damage inherit from the previous tier. Reactive rolls never inherit —
 * their tiers are authored in full and read inverted (the roller wants to roll *low*).
 */
function prepareEffect(effect: PowerEffect, reactive: boolean): PreparedEffect {
  const type = effect.type ?? '';
  const raw = tierBag(effect, type);
  const tiers: (ResolvedTier | undefined)[] = [];
  let previous: ResolvedTier | undefined;
  for (const n of [1, 2, 3] as const) {
    const source = raw[`tier${n}` as const];
    if (!source) {
      tiers.push(undefined);
      previous = undefined;
      continue;
    }
    const inheritable = !reactive ? previous : undefined;
    const resolved: ResolvedTier = {
      value: source.value || inheritable?.value || '',
      types: source.types ?? [],
      display: source.display || inheritable?.display || '',
      movement: source.movement ?? [],
      distance: source.distance ?? '',
      properties: source.properties ?? [],
      potencyValue: source.potency?.value || DEFAULT_POTENCY_VALUE[n],
      potencyCharacteristic: source.potency?.characteristic || previous?.potencyCharacteristic || '',
    };
    tiers.push(resolved);
    previous = resolved;
  }
  return { type, tiers };
}

/** The tier bag under an effect's type key (`effect.damage` / `.applied` / `.other` / `.forced`). */
function tierBag(effect: PowerEffect, type: string): NonNullable<PowerEffect['damage']> {
  return ((effect as Record<string, unknown>)[type] as NonNullable<PowerEffect['damage']> | undefined) ?? {};
}

/** One effect's rendered text for a tier — dispatched by effect type, resolved through the prose converter. */
function effectTierText(effect: PreparedEffect, n: 1 | 2 | 3, potency: Potency): string {
  const tier = effect.tiers[n - 1];
  if (!tier) return '';
  if (effect.type === 'damage') return damageText(tier, potency);
  if (effect.type === 'forced') {
    return foundryProseToText(tier.display, { potency: potencyString(tier, potency), forced: forcedString(tier) });
  }
  // `applied` and `other` are the same shape: a display line with a `{{potency}}` slot.
  return foundryProseToText(tier.display, { potency: potencyString(tier, potency) });
}

/**
 * A damage tier's text (e.g. "16 damage", "11 Holy damage"), dropping a zero/blank tier. A real potency
 * characteristic (rare for damage) prefixes the potency string, matching the system's `formattedPotency`.
 */
function damageText(tier: ResolvedTier, potency: Potency): string {
  const value = tier.value;
  if (!value || Number(value) === 0) return '';
  const damage =
    tier.types.length > 0 ? `${value} ${disjunction(tier.types.map(capitalize))} damage` : `${value} damage`;
  if (tier.potencyCharacteristic && tier.potencyCharacteristic !== 'none') {
    const prefix = potencyString(tier, potency);
    if (prefix) return foundryProseToText(`${prefix} ${damage}`);
  }
  return foundryProseToText(damage);
}

/** The potency string for a tier (e.g. "M < 4"), or `''` when no characteristic gates it (matches the system). */
function potencyString(tier: ResolvedTier, potency: Potency): string {
  const characteristic = tier.potencyCharacteristic;
  if (!characteristic || characteristic === 'none') return '';
  const abbreviation = DS_CHARACTERISTIC_ABBREVIATIONS[characteristic as DsCharacteristicKey];
  if (!abbreviation) return '';
  const value = resolvePotencyValue(tier.potencyValue, potency);
  if (value === undefined) return '';
  return `${abbreviation} < ${value}`;
}

/** Resolve a tier's potency value: a `@potency.weak|average|strong` reference to the monster's number, else the literal. */
function resolvePotencyValue(raw: string, potency: Potency): number | undefined {
  const match = /^@potency\.(weak|average|strong)$/.exec(raw);
  if (match) return potency[match[1] as keyof Potency];
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** The forced-movement string for a tier (e.g. "Slide 2"), mirroring the system's `ForcedMovement.Display`. */
function forcedString(tier: ResolvedTier): string {
  const vertical = tier.properties.includes('vertical');
  const labels = tier.movement.map((movement) => forcedLabel(movement, vertical));
  return `${disjunction(labels)} ${tier.distance}`.trim();
}

/** The label for a forced-movement kind (`push`/`pull`/`slide`), plain or vertical — pinned from the system. */
function forcedLabel(movement: string, vertical: boolean): string {
  const base = capitalize(movement);
  return vertical ? `Vertical ${base}` : base;
}

/**
 * The flat effect text folded from the ability-level `effects` (the `base` prose and `spend` malice options,
 * in sort order), each run through the enricher-resolving converter. A `spend` entry prefixes its malice cost.
 */
function abilityEffectText(effects: NonNullable<AbilityItem['system']>['effects']): string {
  if (!effects) return '';
  return Object.values(effects)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
    .map((entry) => {
      const text = foundryProseToText(entry.description ?? '');
      if (entry.type === 'spend' && typeof entry.resource?.value === 'number') {
        return text ? `${entry.resource.value} Malice: ${text}` : `${entry.resource.value} Malice`;
      }
      return text;
    })
    .filter((text) => text.length > 0)
    .join('\n\n');
}

/** Join a list as an "or" disjunction ("A", "A or B", "A, B, or C"), matching the system's list formatter. */
function disjunction(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`;
}

/** The monster's three potency strengths, derived from its highest characteristic (`weak` = highest − 2, …). */
function monsterPotency(characteristics: MonsterCharacteristics): Potency {
  const scores = DS_CHARACTERISTIC_KEYS.map((key) => characteristics[key]).filter(
    (score): score is number => typeof score === 'number' && Number.isFinite(score),
  );
  const highest = Math.max(0, ...scores);
  return { weak: highest - 2, average: highest - 1, strong: highest };
}

/** Title-case a lowercase source token (a damage type, a movement kind, or a target type fallback). */
function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
