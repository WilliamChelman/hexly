/**
 * The `draw-steel.monsters` **Importer** (ADR-0060): the near-pure producer that fetches the pinned
 * *Monsters* pack through its injected {@link MonstersFetchPort} and transforms each actor into one
 * Import Record. The reconcile lands the Records and stamps their `hexly.source`; this module only
 * fetches and transforms, so it is trivially fixture-tested (ADR-0060).
 *
 * The scalar spine landed in #257 (the five characteristics, level, EV, stamina, stability, speed, keywords,
 * free strike, and the per-type damage immunities/weaknesses). This pass adds the **structural, non-ability**
 * mapping (#258): the size token, movement types, the role→organization remap, condition immunities, the
 * `feature` items folded into `traits[]`, and the biography folded into `core.content` — every prose field
 * run through the one {@link foundryProseToText} converter so no raw enricher token leaks. The `ability` items
 * and their multi-tier power rolls fold into `abilities[]` through {@link abilitiesOf} (#259). The transform is
 * where Creator-License compliance is *baked in*, not left to a checklist
 * (ADR-0061): the actor's art (`img`) is simply never read, so it cannot leak.
 */

import {
  DS_CONDITION_OPTIONS,
  DS_DAMAGE_TYPE_OPTIONS,
  DS_MONSTER,
  DS_MOVEMENT_TYPE_OPTIONS,
  DS_ORGANIZATION_OPTIONS,
  DS_ROLE_OPTIONS,
  DS_SIZE_OPTIONS,
  DS_STAT_BLOCK_KEY,
  DsCondition,
  DsDamageType,
  StatBlock,
  Trait,
} from '@hexly/plugin-draw-steel';
import { CONTENT_FIELD } from '@hexly/plugin-content';
import { ImportContext, Importer, ImportProduction, ImportRecord } from '@hexly/domain';
import { z } from 'zod';
import { foundryProseToContent, foundryProseToText } from './foundry-prose';
import { abilitiesOf, MonsterCharacteristics } from './monster-abilities';
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

/** The subset of a Foundry npc actor `_source` this transform reads — every stat optional and defensively parsed. */
const characteristicSchema = z.object({ value: z.number().finite() }).partial();
const damageRecordSchema = z.record(z.string(), z.number()).optional();
const descriptionSchema = z.object({ value: z.string(), director: z.string() }).partial().optional();

/** A Foundry `feature` item; only its name + description are read (→ traits). Abilities are parsed apart, in {@link abilitiesOf}. */
const featureItemSchema = z
  .object({
    name: z.string(),
    type: z.string(),
    system: z.object({ description: descriptionSchema }).partial().optional(),
  })
  .partial();

const rawMonsterSchema = z.object({
  _id: z.string().optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  img: z.string().optional(), // read only to be *ignored* — art is dropped (ADR-0061); never copied into the document
  // Items stay raw here: the ability transform (#259) needs the full item, not a feature-only projection.
  items: z.array(z.unknown()).optional(),
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
      combat: z
        .object({
          stability: z.number().finite(),
          size: z.object({ value: z.number().finite(), letter: z.string() }).partial(),
        })
        .partial()
        .optional(),
      movement: z
        .object({ value: z.number().finite(), types: z.array(z.string()), hover: z.boolean() })
        .partial()
        .optional(),
      damage: z.object({ immunities: damageRecordSchema, weaknesses: damageRecordSchema }).partial().optional(),
      biography: descriptionSchema,
      // The condition-immunity source when present — a set of condition tokens; empty across today's pack (#258).
      statuses: z
        .object({ immunities: z.array(z.string()) })
        .partial()
        .optional(),
      monster: z
        .object({
          freeStrike: z.number().finite(),
          keywords: z.array(z.string()),
          level: z.number().finite(),
          role: z.string(),
          organization: z.string(),
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
 * Maps the scalar spine (#257) plus the structural, non-ability fields (#258) into a {@link StatBlock}, and
 * folds the biography into `core.content` — omitting that field entirely when the biography is empty. `img`
 * is intentionally absent from the output — the actor's art never crosses into the Entity Document (ADR-0061).
 */
export function toMonsterRecord(raw: unknown): ImportRecord | null {
  const parsed = rawMonsterSchema.safeParse(raw);
  if (!parsed.success) return null;
  const actor = parsed.data;
  if (actor.type && actor.type !== 'npc') return null;

  const document: Record<string, unknown> = { [DS_STAT_BLOCK_KEY]: statBlockOf(actor) };
  // Biography + director notes → prose, but only when there is any: an empty biography contributes no
  // `core.content` field at all (#258), rather than an empty document the reconcile would still land.
  const content = foundryProseToContent(joinProse(actor.system?.biography));
  if (content) document[CONTENT_FIELD.id] = content;

  return {
    // The Foundry `_id` is the stable upstream key the reconcile upserts by; an unnamed actor still
    // yields a Record so the reconcile can tally it as a skip rather than lose it silently.
    sourceId: actor._id ?? '',
    name: actor.name ?? '',
    types: [DS_MONSTER],
    document,
  };
}

/** The scalar stats (#257) and the structural fields — size, movement, identity, conditions, traits (#258) — each set only when present so the block stays minimal. */
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

  const size = sizeToken(system.combat?.size);
  if (size) block.size = size;

  const movementTypes = movementTypesOf(system.movement);
  if (movementTypes.length > 0) block.movement_types = movementTypes;

  assignIdentity(block, system.monster?.role, system.monster?.organization);

  const conditionImmunities = conditionsOf(system.statuses?.immunities);
  if (conditionImmunities.length > 0) block.condition_immunities = conditionImmunities;

  const traits = traitsOf(actor.items);
  if (traits.length > 0) block.traits = traits;

  const abilities = abilitiesOf(actor.items, characteristicScores(characteristics));
  if (abilities.length > 0) block.abilities = abilities;

  return block;
}

/** The five characteristic scores as a flat record — the potency input the ability transform's power rolls read (#259). */
function characteristicScores(
  characteristics: NonNullable<RawMonster['system']>['characteristics'],
): MonsterCharacteristics {
  const source = characteristics ?? {};
  return {
    might: source.might?.value,
    agility: source.agility?.value,
    reason: source.reason?.value,
    intuition: source.intuition?.value,
    presence: source.presence?.value,
  };
}

/** The closed enum vocabularies as membership sets — allocated once, shared by the structural mappers below. */
const KNOWN_SIZES = new Set<string>(DS_SIZE_OPTIONS);
const KNOWN_MOVEMENT_TYPES = new Set<string>(DS_MOVEMENT_TYPE_OPTIONS);
const KNOWN_ROLES = new Set<string>(DS_ROLE_OPTIONS);
const KNOWN_ORGANIZATIONS = new Set<string>(DS_ORGANIZATION_OPTIONS);
const KNOWN_CONDITIONS = new Set<string>(DS_CONDITION_OPTIONS);

/**
 * Compose the printed size token from Foundry's numeric value + letter (#258): a value of 1 pairs with its
 * letter (`1L`, `1S`, `1M`, `1T`), a value ≥ 2 is the bare number (`2`…`5`). Anything outside the closed set
 * ({@link DS_SIZE_OPTIONS}) is dropped rather than coerced.
 */
function sizeToken(size: { value?: number; letter?: string } | undefined): StatBlock['size'] | undefined {
  if (typeof size?.value !== 'number') return undefined;
  const token = size.value >= 2 ? String(size.value) : `1${(size.letter ?? '').toUpperCase()}`;
  return KNOWN_SIZES.has(token) ? (token as StatBlock['size']) : undefined;
}

/**
 * The movement kinds beyond the default walk (#258): the source `types` with `walk` filtered out (every
 * creature walks; the block only lists the extras) and the separate `hover` boolean folded in as a type.
 * Only known movement kinds survive; source order is preserved.
 */
function movementTypesOf(
  movement: { types?: string[]; hover?: boolean } | undefined,
): NonNullable<StatBlock['movement_types']> {
  const types = (movement?.types ?? []).filter((type) => type !== 'walk' && KNOWN_MOVEMENT_TYPES.has(type));
  if (movement?.hover && !types.includes('hover')) types.push('hover');
  return types as NonNullable<StatBlock['movement_types']>;
}

/**
 * Route the source role/organization onto the block (#258). Draw Steel stores `solo`/`leader` as a `role`
 * even though they are *organizations* in the schema ({@link DS_ROLE_OPTIONS} excludes them) — so a role that
 * is really an organization token is routed to `organization`, and Ajax (`role: solo`) reads as a Solo, not a
 * role. A genuine role (`harrier`, …) lands on `role`; an explicit valid organization always wins.
 */
function assignIdentity(block: StatBlock, role: string | undefined, organization: string | undefined): void {
  if (role && KNOWN_ROLES.has(role)) block.role = role as StatBlock['role'];
  // An explicit valid organization wins; otherwise a role that is really an organization token routes here.
  const org =
    organization && KNOWN_ORGANIZATIONS.has(organization)
      ? organization
      : role && KNOWN_ORGANIZATIONS.has(role)
        ? role
        : undefined;
  if (org) block.organization = org as StatBlock['organization'];
}

/** The condition immunities the creature carries — keeping only known condition tokens ({@link DS_CONDITION_OPTIONS}). */
function conditionsOf(immunities: string[] | undefined): DsCondition[] {
  return (immunities ?? []).filter((condition): condition is DsCondition => KNOWN_CONDITIONS.has(condition));
}

/**
 * The passive traits, from the actor's `feature` items (#258): each item's name plus its description and
 * director notes, run through the one enricher-resolving converter. A feature whose prose is empty still
 * yields a trait (its name is the content), mirroring how the source lists a named-only trait.
 */
function traitsOf(items: RawMonster['items']): Trait[] {
  const traits: Trait[] = [];
  for (const raw of items ?? []) {
    const parsed = featureItemSchema.safeParse(raw);
    if (!parsed.success) continue;
    const item = parsed.data;
    if (item.type !== 'feature' || typeof item.name !== 'string') continue;
    traits.push({ name: item.name, effect: foundryProseToText(joinProse(item.system?.description)) });
  }
  return traits;
}

/**
 * Fold a Foundry description's public value and its director-only notes into one string for conversion,
 * separated by a blank line so the director note always starts a fresh paragraph — even when the value is
 * plain text with no trailing block tag for {@link foundryProseToText} to break on.
 */
function joinProse(description: { value?: string; director?: string } | undefined): string {
  return [description?.value, description?.director]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join('\n\n');
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
