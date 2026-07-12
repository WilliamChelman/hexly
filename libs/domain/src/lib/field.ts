/**
 * Typed **Fields** as a lens over **Metadata** (CONTEXT.md → Field, ADR-0048).
 *
 * A Field is not a store: it gives one Metadata key a name, a data-type, and
 * facet-ability, while the value stays in the Entity's one Metadata map. So a
 * missing plugin (an absent Type Definition) leaves the value as plain Metadata,
 * and Obsidian import/export (ADR-0033) is untouched — the Field only *types and
 * surfaces* a key it never owns.
 *
 * This module is the pure heart of the feature, shared by the API write-path gate
 * and the web generic Field view: the Field vocabulary, the `types[] → union of
 * Field schemas` resolution, the **forward-only** value validation, and the
 * value reader/writer over the Metadata map. A typed **Entity Link** field (ADR-0046, #190) joins
 * the scalar / enum / date / list data-types here: a Field pointing at another Entity, harvested
 * into the World Graph edge index and degrading gracefully when the target is gone.
 */

import { z } from 'zod';
import { entityTypeSchema } from './entity';
import { StructuredDataType, structuredDataTypeIdSchema, StructuredDataTypeSet } from './structured-data-type';

/** The Metadata map a Field reads from and writes to — the one store, never forked (CONTEXT.md → Metadata). */
export type Metadata = Record<string, unknown>;

/** The scalar Field data-types — the item types a `list` may hold, and Fields in their own right. */
const stringType = z.object({ kind: z.literal('string') });
const numberType = z.object({ kind: z.literal('number') });
const booleanType = z.object({ kind: z.literal('boolean') });
const dateType = z.object({ kind: z.literal('date') });
/** An `enum` names a closed set of string options; at least one, each non-blank. */
const enumType = z.object({
  kind: z.literal('enum'),
  options: z.array(z.string().trim().min(1)).min(1),
});

/**
 * A scalar Field data-type — everything but `list`, so a list's item type can be
 * declared without admitting a list of lists (kept one level deep on purpose).
 */
export const scalarDataTypeSchema = z.discriminatedUnion('kind', [
  stringType,
  numberType,
  booleanType,
  dateType,
  enumType,
]);

export type ScalarDataType = z.infer<typeof scalarDataTypeSchema>;

/** A `list` of a scalar item type — homogeneous, one level deep. */
const listType = z.object({
  kind: z.literal('list'),
  of: scalarDataTypeSchema,
});

/**
 * A typed **Entity Link** Field (CONTEXT.md → Entity Link, ADR-0046, #190): a Field pointing at
 * another Entity. `targetTypes` is the optional target-type constraint (a `lair` must point at a
 * place); omitted or empty means any Entity is valid. Not a scalar — so no `list` of links, which
 * would need a multi-picker the ticket doesn't build.
 */
const entityLinkType = z.object({
  kind: z.literal('entityLink'),
  targetTypes: z.array(entityTypeSchema).optional(),
});

/**
 * The **built-in** Field data-types: a scalar (`string`/`number`/`boolean`/`date`), an `enum` over a
 * closed option set, a `list` of any of those, or a typed `entityLink` pointing at another Entity.
 * A closed set of exact literals — each is a form control the core knows how to render (ADR-0048).
 */
export const builtInDataTypeSchema = z.discriminatedUnion('kind', [
  stringType,
  numberType,
  booleanType,
  dateType,
  enumType,
  listType,
  entityLinkType,
]);

export type BuiltInDataType = z.infer<typeof builtInDataTypeSchema>;

/** A **Structured Field**'s data-type, named by a plugin's `namespace.id` id — see `structured-data-type.ts`. */
const structuredDataTypeRefSchema = z.object({ kind: structuredDataTypeIdSchema });

export type StructuredDataTypeRef = z.infer<typeof structuredDataTypeRefSchema>;

/**
 * The Field data-type: a built-in, or a plugin-contributed structured one — an **open** set, since a
 * kind is structured *iff* it is namespaced (ADR-0050). A kind that is neither a built-in literal nor
 * `namespace.id`-shaped (`strig`) is rejected here, where the Field is declared.
 */
export const fieldDataTypeSchema = z.union([builtInDataTypeSchema, structuredDataTypeRefSchema]);

export type FieldDataType = z.infer<typeof fieldDataTypeSchema>;

/** Whether a Field's data-type is structured. No built-in kind carries a dot, so the dot *is* the mark. */
export function isStructuredDataType(dataType: FieldDataType): dataType is StructuredDataTypeRef {
  return dataType.kind.includes('.');
}

/**
 * Resolve a structured Field's data-type against the host-composed set. `undefined` for an
 * unregistered kind — an absent plugin, or a typo. Its two readers take that `undefined` in opposite
 * directions: an error where a Type is declared ({@link unresolvedDataTypeErrors}), inert where a
 * value is validated ({@link validateFields}).
 */
function resolveStructuredDataType(
  dataTypes: StructuredDataTypeSet,
  dataType: StructuredDataTypeRef,
): StructuredDataType | undefined {
  return dataTypes.get(dataType.kind);
}

/**
 * The stored value of an `entityLink` Field: the target's `entityId` plus a `label` snapshot of its
 * name at pick time — the last-known name a deleted/inaccessible target degrades to instead of
 * erroring (CONTEXT.md → Entity Link), mirroring the Content link's `{ entityId, label }`. Non-strict,
 * so a hand-authored value carrying only `entityId` (label defaults to blank) is tolerated.
 */
export const entityLinkValueSchema = z.object({
  entityId: z.string().trim().min(1),
  label: z.string().default(''),
});

export type EntityLinkValue = z.infer<typeof entityLinkValueSchema>;

/** Whether a data-type is a typed Entity Link. For callers that need only the yes/no, not narrowing. */
export function isEntityLinkDataType(dataType: FieldDataType): boolean {
  return dataType.kind === 'entityLink';
}

/**
 * One Field's declaration in a Type Definition's schema: the Metadata `key` it
 * types, a human `label`, its `dataType`, whether it is `required`, and whether it
 * is `facetable` (surfaced as a per-type facet in the Entity Browser, ADR-0035).
 * `required` and `facetable` default to false so a terse `{ key, label, dataType }`
 * declares an optional, non-facetable Field.
 *
 * A **code-registered** Field (a plugin's, the core's) may add a {@link labelKey}, the transloco key
 * its shipped copy lives under: a plugin ships translated copy where a World Owner ships one authored
 * name — the split a Type already makes between its `labels` and a user-defined type's `labelText`
 * (ADR-0014).
 */
export const fieldSchemaSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
  /**
   * A transloco key for this Field's display name, when one ships with the code that declares it. The
   * web prefers it over {@link label}; the API has no copy, so `label` stays the untranslated name it
   * reports. A user-defined Field has none — its `label` is authored data, and translating it would
   * mean looking up a key its author never wrote.
   */
  labelKey: z.string().trim().min(1).optional(),
  dataType: fieldDataTypeSchema,
  required: z.boolean().default(false),
  facetable: z.boolean().default(false),
});

export type FieldSchema = z.infer<typeof fieldSchemaSchema>;

/**
 * The Field schemas a single Entity Type declares, keyed by type id — the shape
 * both the web {@link TypeRegistry} and the API type registry resolve against.
 * Returns `undefined` for a type that declares no Fields (a core type, or an
 * absent plugin), which resolves to nothing rather than throwing.
 */
export type TypeFieldResolver = (typeId: string) => readonly FieldSchema[] | undefined;

/**
 * The union of Field schemas an Entity carrying `types` affords — every type's
 * declared Fields, in `types` order (primary type first), deduped by `key`. When
 * two types type the same Metadata key, the primary type's declaration wins, so a
 * Field's meaning is stable regardless of the secondary types layered on.
 */
export function resolveFields(resolver: TypeFieldResolver, types: readonly string[]): FieldSchema[] {
  const byKey = new Map<string, FieldSchema>();
  for (const type of types)
    for (const fieldSchema of resolver(type) ?? [])
      if (!byKey.has(fieldSchema.key)) byKey.set(fieldSchema.key, fieldSchema);
  return [...byKey.values()];
}

/**
 * Why one Field failed validation: `required` (absent), `type` (present but ill-typed), or
 * `unknown-data-type` — a **Structured Field** naming a data-type the host has not registered
 * (ADR-0050). The last is a broken *declaration*, not a bad value, so it is raised by
 * {@link unresolvedDataTypeErrors} where a Type is declared, never by the value gate.
 */
export interface FieldError {
  readonly key: string;
  readonly code: 'required' | 'type' | 'unknown-data-type';
}

/** The outcome of {@link validateFields}: `ok` with the offending Fields, if any. */
export interface FieldValidation {
  readonly ok: boolean;
  readonly errors: readonly FieldError[];
}

/**
 * The **forward-only** validation gate (CONTEXT.md → Field, ADR-0048): validate a
 * resolved Field set against an Entity's Metadata. A required Field must be present;
 * a *present* value — required or not — must match its data-type. An absent optional
 * Field is fine, and any Metadata key with no Field is ignored entirely (a Field is
 * a lens, not a whitelist).
 *
 * Pure and side-effect-free: the caller (the API write path) decides *when* to
 * enforce it — active typed edits only, never on import or data at rest — so already
 * stored or imported Metadata is never retroactively invalidated.
 *
 * A **Structured Field** validates against its data-type's own `valueSchema`, resolved from the
 * host-composed `dataTypes` (ADR-0050). One whose kind that set does not carry is *inert* — skipped,
 * its value left as plain Metadata, exactly as an absent plugin's Fields are. That is what lets a
 * build that drops a plugin still open and save its Entities; the unregistered kind is rejected
 * where the Type is declared instead ({@link unresolvedDataTypeErrors}).
 */
export function validateFields(
  fields: readonly FieldSchema[],
  metadata: Metadata | undefined,
  dataTypes: StructuredDataTypeSet,
): FieldValidation {
  const errors: FieldError[] = [];
  for (const field of fields) {
    const matches = valueMatcher(field.dataType, dataTypes);
    if (!matches) continue;
    const value = metadata?.[field.key];
    if (isAbsent(value)) {
      if (field.required) errors.push({ key: field.key, code: 'required' });
      continue;
    }
    if (!matches(value)) errors.push({ key: field.key, code: 'type' });
  }
  return { ok: errors.length === 0, errors };
}

/**
 * The value predicate a Field's data-type resolves to: the built-in type check, or a structured
 * data-type's own `valueSchema`. `undefined` when a structured kind resolves to nothing — there is no
 * shape to hold the value to, so the gate above skips it.
 */
function valueMatcher(
  dataType: FieldDataType,
  dataTypes: StructuredDataTypeSet,
): ((value: unknown) => boolean) | undefined {
  if (!isStructuredDataType(dataType)) return (value) => matchesBuiltInDataType(dataType, value);
  const structured = resolveStructuredDataType(dataTypes, dataType);
  return structured && ((value: unknown) => structured.valueSchema.safeParse(value).success);
}

/**
 * The **declaration** gate (ADR-0050): every Field naming a structured data-type the host's set does
 * not carry — a typo (`core.gird`), or a plugin this build does not bundle. The host runs it where
 * a Type is declared (a plugin type at startup, a **User-defined type** as a World Owner saves it),
 * never against an Entity's Metadata.
 */
export function unresolvedDataTypeErrors(
  fields: readonly FieldSchema[],
  dataTypes: StructuredDataTypeSet,
): FieldError[] {
  return fields.flatMap((field) =>
    isStructuredDataType(field.dataType) && !resolveStructuredDataType(dataTypes, field.dataType)
      ? [{ key: field.key, code: 'unknown-data-type' as const }]
      : [],
  );
}

/**
 * One denormalised **facetable** Field value (ADR-0048, #188), the Field peer of the `types`/`tags`
 * denormalisation: the Metadata `key` it types, its canonical string `value`, and a `num` — the
 * numeric form of a `number` Field, else `null`. `num` is what lets a range filter compare a number
 * *as a number* (`cr >= 5`), while an enum/date/string compares its `value` lexically (ISO dates sort
 * correctly as text). Materialised on write and rebuilt by Reindex, so a Field facet is queryable
 * without loading each body.
 */
export interface FieldFacetValue {
  readonly key: string;
  readonly value: string;
  readonly num: number | null;
}

/**
 * The pure Field-facet derivation (ADR-0048, #188): a resolved Field set + an Entity's Metadata →
 * the denormalised facet values to materialise. Only **facetable** Fields contribute, only a
 * *present, well-typed* value is indexed (an ill-typed value at rest is tolerated, never faceted),
 * a `list` explodes to one value per item, and values repeated within one Entity collapse so a facet
 * count is per-Entity rather than per-occurrence. Side-effect-free — the write path feeds the result
 * to the denormalised table, and Reindex re-runs it from the stored document for free.
 *
 * A **Structured Field** never contributes a facet whatever its `facetable` flag says (ADR-0050): a
 * document has no discrete values to count, so there is nothing a facet could offer.
 */
export function deriveFieldFacets(fields: readonly FieldSchema[], metadata: Metadata | undefined): FieldFacetValue[] {
  const seen = new Set<string>();
  const out: FieldFacetValue[] = [];
  for (const field of fields) {
    if (!field.facetable || isStructuredDataType(field.dataType)) continue;
    const raw = readField(metadata, field);
    if (raw === undefined || raw === null) continue;
    for (const item of facetItems(field.dataType, raw)) {
      // Dedup on the (key, value) pair so a value repeated within one Entity (a list with dupes)
      // counts once — JSON.stringify keeps the two parts unambiguous whatever they contain.
      const dedupKey = JSON.stringify([field.key, item.value]);
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      out.push({ key: field.key, value: item.value, num: item.num });
    }
  }
  return out;
}

/**
 * A Field's facet rows: a `list` maps each well-typed item, an `entityLink` yields its target id
 * (so the facet filters "lair = <place>" by a stable id, not the mutable name), a scalar its one
 * well-typed value.
 */
function facetItems(dataType: BuiltInDataType, raw: unknown): { value: string; num: number | null }[] {
  if (dataType.kind === 'list') return Array.isArray(raw) ? raw.flatMap((item) => scalarFacet(dataType.of, item)) : [];
  if (dataType.kind === 'entityLink') {
    const parsed = entityLinkValueSchema.safeParse(raw);
    return parsed.success ? [{ value: parsed.data.entityId, num: null }] : [];
  }
  return scalarFacet(dataType, raw);
}

/** A scalar's facet row, or nothing if it doesn't inhabit the data-type (forward-only tolerance). */
function scalarFacet(dataType: ScalarDataType, raw: unknown): { value: string; num: number | null }[] {
  if (!matchesBuiltInDataType(dataType, raw)) return [];
  return dataType.kind === 'number'
    ? [{ value: String(raw), num: raw as number }]
    : [{ value: String(raw), num: null }];
}

/**
 * Every Entity-Link Field value an Entity's Metadata carries (#190), keyed by the Field. Only an
 * `entityLink` Field with a present, shape-valid value contributes (a blank or ill-typed one is
 * skipped, forward-only). Feeds {@link harvestEdges}.
 */
export function entityLinkFieldValues(
  fields: readonly FieldSchema[],
  metadata: Metadata | undefined,
): { key: string; value: EntityLinkValue }[] {
  const out: { key: string; value: EntityLinkValue }[] = [];
  for (const field of fields) {
    if (field.dataType.kind !== 'entityLink') continue;
    const parsed = entityLinkValueSchema.safeParse(readField(metadata, field));
    if (parsed.success) out.push({ key: field.key, value: parsed.data });
  }
  return out;
}

/**
 * Every **Structured Field** in a resolved set, paired with the data-type it resolves to (ADR-0050).
 * An unregistered kind drops out rather than throwing — nothing can render or harvest it.
 */
export function resolvedStructuredFields(
  fields: readonly FieldSchema[],
  dataTypes: StructuredDataTypeSet,
): { field: FieldSchema; dataType: StructuredDataType }[] {
  const out: { field: FieldSchema; dataType: StructuredDataType }[] = [];
  for (const field of fields) {
    if (!isStructuredDataType(field.dataType)) continue;
    const dataType = resolveStructuredDataType(dataTypes, field.dataType);
    if (dataType) out.push({ field, dataType });
  }
  return out;
}

/**
 * One Entity-Link Field whose target-type constraint the write gate must check (#190): the Field
 * `key`, the linked `entityId`, and the non-empty `targetTypes` the target's types must intersect.
 * Only a constrained Field (`targetTypes` non-empty) with a present value yields one. The caller
 * resolves each `entityId`'s actual types from the DB — a missing target has nothing to check.
 */
export interface EntityLinkConstraint {
  readonly key: string;
  readonly entityId: string;
  readonly targetTypes: readonly string[];
}

export function entityLinkConstraints(
  fields: readonly FieldSchema[],
  metadata: Metadata | undefined,
): EntityLinkConstraint[] {
  const out: EntityLinkConstraint[] = [];
  for (const field of fields) {
    if (field.dataType.kind !== 'entityLink') continue;
    const targetTypes = field.dataType.targetTypes ?? [];
    if (targetTypes.length === 0) continue;
    const parsed = entityLinkValueSchema.safeParse(readField(metadata, field));
    if (parsed.success) out.push({ key: field.key, entityId: parsed.data.entityId, targetTypes });
  }
  return out;
}

/** The comparison a {@link FieldFilter} applies: `eq` membership, or a `gte`/`lte` range bound. */
export type FieldFilterOp = 'eq' | 'gte' | 'lte';

const FIELD_FILTER_OPS: ReadonlySet<string> = new Set<FieldFilterOp>(['eq', 'gte', 'lte']);

/**
 * One filter-by-Field constraint (ADR-0048, #188): the Metadata `key`, an `op`, and the compared
 * `value`. `eq` on the same key OR together (enum/list membership); `gte`/`lte` on the same key form
 * a range; different keys AND — mirroring the universal facets. Wire form is `key:op:value`.
 */
export interface FieldFilter {
  readonly key: string;
  readonly op: FieldFilterOp;
  readonly value: string;
}

/**
 * Parse one `key:op:value` token, splitting on the **first two** colons so a value carrying its own
 * (an ISO datetime) survives intact. `null` for a malformed token — the caller drops it rather than
 * 400ing, so a stale or hand-edited URL degrades to no-filter instead of breaking the browse.
 */
export function parseFieldFilter(raw: string): FieldFilter | null {
  const first = raw.indexOf(':');
  if (first <= 0) return null;
  const second = raw.indexOf(':', first + 1);
  if (second < 0) return null;
  const op = raw.slice(first + 1, second);
  const value = raw.slice(second + 1);
  if (!FIELD_FILTER_OPS.has(op) || value === '') return null;
  return { key: raw.slice(0, first), op: op as FieldFilterOp, value };
}

/** Parse the repeated `field` query params, keeping the valid tokens and dropping the rest. */
export function parseFieldFilters(raw: readonly string[] | undefined): FieldFilter[] {
  return (raw ?? []).flatMap((token) => {
    const parsed = parseFieldFilter(token);
    return parsed ? [parsed] : [];
  });
}

/** Read a Field's value straight off the Metadata map — the lens, so it never copies or coerces. */
export function readField(metadata: Metadata | undefined, field: FieldSchema): unknown {
  return metadata?.[field.key];
}

/**
 * Write a Field's value back into the Metadata map, returning a fresh map (pure —
 * the caller feeds it to an Immer draft or a signal). An emptied value clears the
 * key, leaving every sibling Metadata entry untouched, so the map never accretes
 * blank keys and removing a Field's value is indistinguishable from never setting it.
 */
export function writeField(metadata: Metadata | undefined, field: FieldSchema, value: unknown): Metadata {
  const next: Metadata = { ...(metadata ?? {}) };
  if (isEmpty(value)) delete next[field.key];
  else next[field.key] = value;
  return next;
}

/** Absent for the *required* check: `undefined`/`null` (an absent key), not a present-but-empty value. */
function isAbsent(value: unknown): boolean {
  return value === undefined || value === null;
}

/** Emptied for {@link writeField}: absent, a blank string, or an empty list — all "clear the key". */
function isEmpty(value: unknown): boolean {
  return isAbsent(value) || value === '' || (Array.isArray(value) && value.length === 0);
}

/**
 * Whether `value` inhabits a *built-in* `dataType` — the per-kind type check the forward-only gate
 * rides. A structured data-type rides its own `valueSchema` instead ({@link valueMatcher}), so this
 * switch stays closed and exhaustive.
 */
function matchesBuiltInDataType(dataType: BuiltInDataType, value: unknown): boolean {
  switch (dataType.kind) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      // Reject NaN/±Infinity: JSON can carry no infinities, but an in-memory edit can, and a
      // non-finite "number" is never a valid Field value.
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'date':
      return typeof value === 'string' && isIsoDateString(value);
    case 'enum':
      return typeof value === 'string' && dataType.options.includes(value);
    case 'list':
      return Array.isArray(value) && value.every((item) => matchesBuiltInDataType(dataType.of, item));
    case 'entityLink':
      // Shape only — the *target-type* constraint needs the target's own types, so it is enforced
      // by the API write gate (a DB read the pure gate can't make), not here (#190).
      return entityLinkValueSchema.safeParse(value).success;
  }
}

/**
 * An ISO-8601 date (`YYYY-MM-DD`) with an optional time part. Metadata dates arrive
 * as strings (frontmatter YAML re-serialized to JSON, ADR-0033), so a Field date is
 * a string, not a `Date`. The shape regex fences out garbage before the parse, and
 * the parse rejects an impossible calendar date the shape alone would admit.
 */
function isIsoDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/.test(value)) return false;
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  // Round-trip the date part through UTC: a rolled-over day (e.g. 02-30 → 03-02) proves it was invalid.
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
