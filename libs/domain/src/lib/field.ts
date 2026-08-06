/**
 * Typed **Fields** as a lens over **EntityDocument** (CONTEXT.md → Field, ADR-0048, ADR-0056).
 *
 * A Field is not a store: its `id` — one `namespace.id` key — names the EntityDocument slot it types, gives
 * it a data-type and facet-ability, while the value stays in the Entity's one EntityDocument map. An absent
 * Type Definition (a missing plugin) leaves the value as plain EntityDocument, and Obsidian import/export
 * (ADR-0033) is untouched — the Field only *types and surfaces* a key it never owns.
 */

import * as z from 'zod';
import { entityTypeSchema } from './entity';
import { fieldIdSchema } from './field-id';
import {
  StructuredDataType,
  StructuredDataTypeId,
  structuredDataTypeIdSchema,
  StructuredDataTypeSet,
  VaultSlot,
  vaultSlotSchema,
} from './structured-data-type';

/** The **Entity Document** a Field reads from and writes to — the one store, never forked (CONTEXT.md → Entity Document). */
export type EntityDocument = Record<string, unknown>;

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

/** A scalar Field data-type — everything but `list`, so a list's item type admits no list of lists. */
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
 * A typed **Entity Link** Field (CONTEXT.md → Entity Link, ADR-0046): a Field pointing at another
 * Entity. `targetTypes` is the optional target-type constraint (a `lair` must point at a place);
 * omitted or empty means any Entity is valid. Not a scalar — there is no `list` of links.
 */
const entityLinkType = z.object({
  kind: z.literal('entityLink'),
  targetTypes: z.array(entityTypeSchema).optional(),
});

/**
 * The **built-in** Field data-types — a closed set of exact literals, each a form control the core
 * knows how to render (ADR-0048).
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

/** A reference to a **Structured Data Type**, named by a plugin's `namespace.id` id — see `structured-data-type.ts`. */
const structuredDataTypeRefSchema = z.object({ kind: structuredDataTypeIdSchema });

export type StructuredDataTypeRef = z.infer<typeof structuredDataTypeRefSchema>;

/**
 * The Field data-type: a built-in, or a plugin-contributed structured one — an **open** set, since a
 * kind is structured *iff* it carries the `datatype` kind segment (ADR-0050). A kind that is neither a
 * built-in literal nor `namespace.datatype.name`-shaped is rejected here, where the Field is declared.
 */
export const fieldDataTypeSchema = z.union([builtInDataTypeSchema, structuredDataTypeRefSchema]);

export type FieldDataType = z.infer<typeof fieldDataTypeSchema>;

/**
 * Whether a data-type *kind* is structured: no built-in kind carries the `datatype` segment, so the
 * segment is the mark (ADR-0050) — and a Field or Type id passed here by mistake reads unstructured
 * rather than slipping through on its dot. Takes a bare kind, for a caller holding one loose (a
 * `<select>`'s string value).
 */
export function isStructuredKind(kind: string): kind is StructuredDataTypeId {
  return kind.split('.')[1] === 'datatype';
}

/** Whether a Field's data-type is structured — {@link isStructuredKind}, narrowing the data-type. */
export function isStructuredDataType(dataType: FieldDataType): dataType is StructuredDataTypeRef {
  return isStructuredKind(dataType.kind);
}

/**
 * Resolve a Field's **Structured Data Type** against the host-composed set. `undefined` for an
 * unregistered kind — an absent plugin, or a typo — which is an error where a Type is declared
 * ({@link unresolvedDataTypeErrors}) but inert where a value is validated ({@link validateFields}).
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
 * erroring (CONTEXT.md → Entity Link). Non-strict, so a hand-authored value carrying only `entityId`
 * (label defaults to blank) is tolerated.
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
 * Whether a Field is offered as a **direct** Facet. A Field of a **Structured Data Type** never is,
 * whatever its `facetable` flag says (ADR-0050): the blob has no discrete values to count. Its Data Type
 * may still *harvest* facet dimensions instead ({@link deriveDocumentState}, ADR-0055).
 */
export function isFacetableField(field: Field): field is Field & { dataType: BuiltInDataType } {
  return field.facetable && !isStructuredDataType(field.dataType);
}

/**
 * A Field's attributes *without* its identity (ADR-0056): a human `label`, its `dataType`, whether it is
 * `required`, and whether it is `facetable` (surfaced as a per-type facet in the Entity Browser, ADR-0035).
 * The id-less half a create/update request body carries; {@link fieldSchema} promotes it with the `id` that
 * *is* its EntityDocument key.
 */
export const fieldSchemaSchema = z.object({
  label: z.string().trim().min(1),
  /**
   * A transloco key for this Field's display name, set only on a **code-registered** Field (a plugin's,
   * the core's). The web prefers it over {@link label}; the API has no copy, so it reports the
   * untranslated `label`. A user-defined Field has none — its `label` is authored data (ADR-0014).
   */
  labelKey: z.string().trim().min(1).optional(),
  dataType: fieldDataTypeSchema,
  /**
   * **Advisory** (CONTEXT.md → Incomplete, ADR-0074): `required` prompts an author and flags a surface, it
   * never refuses a write. An Entity missing one reads **Incomplete** ({@link FieldValidation.incomplete});
   * only a *present* value of the wrong shape is an error.
   */
  required: z.boolean().default(false),
  facetable: z.boolean().default(false),
  /**
   * An optional **Vault Projection** override (CONTEXT.md → Vault Projection, ADR-0051): a Field may
   * force its value's slot away from the data-type's default — a second prose Field kept out of the
   * body, say. Absent means "take the data-type's default"; see {@link vaultSlotOf}.
   */
  vault: z.object({ slot: vaultSlotSchema }).optional(),
  /**
   * **System-managed** (CONTEXT.md → System-managed, ADR-0068): the system alone attaches and detaches this
   * Field, in both directions — set only on a code-registered Field (`core.field.asset`), never authored.
   * Surfaces *derive* behavior from it (pickers don't offer it, the Details panel renders it affordance-less),
   * and the entity write choke point rejects a user-initiated attach/detach of it. The marker crosses the web
   * seam by riding {@link Field}; the original leak was that a marker never did. Governs shape, not value.
   */
  systemManaged: z.boolean().optional(),
  /**
   * **Decor Link** (CONTEXT.md → Decor Link, ADR-0069): this Field's Entity-Link edges exist for
   * presentation and carry no worldbuilding meaning. `core.field.thumbnail` sets it; the World-scoped
   * field editor exposes it as a checkbox (default off) so a user-defined "Portrait" link doesn't
   * re-flood the graph. Classifies the *edge* at harvest ({@link deriveDocumentState}); relation surfaces
   * hide decor by default, usage surfaces count it. Only meaningful on an `entityLink` Field.
   */
  decor: z.boolean().optional(),
});

export type FieldSchema = z.infer<typeof fieldSchemaSchema>;

/**
 * A first-class, reusable **Field** (CONTEXT.md → Field, ADR-0054/ADR-0056): a {@link FieldSchema} promoted
 * with its `namespace.id` {@link fieldIdSchema} `id` — its reuse handle *and* the EntityDocument key it
 * lenses, one identifier (ADR-0056). A Type Definition references one by id (`fieldRefs`) and an Entity
 * attaches one by id (`fields`), so the same Field is a default of many types or rides an Entity whose types
 * never named it. Every downstream pure function keys the document off `field.id`.
 */
export const fieldSchema = fieldSchemaSchema.extend({ id: fieldIdSchema });

export type Field = z.infer<typeof fieldSchema>;

/**
 * Declare a code-registered **Plugin field** (CONTEXT.md → Field, ADR-0054), mirroring `defineType`. A
 * malformed field — a bare `id` (no namespace), or an unknown `dataType` kind (neither a built-in nor
 * `namespace.id`-shaped) — throws at module load rather than at runtime. Membership of a structured
 * data-type is *not* checked here (no schema could enumerate the plugin registering it); an unregistered
 * kind is caught at resolution, as with any **Structured Data Type**.
 */
export function defineField(definition: {
  readonly id: string;
  readonly label: string;
  readonly labelKey?: string;
  readonly dataType: FieldDataType;
  /** **Advisory** (ADR-0074): prompts an author and flags a surface; absence never refuses a write. */
  readonly required?: boolean;
  readonly facetable?: boolean;
  readonly vault?: { slot: VaultSlot };
  /** **System-managed** (ADR-0068): the system alone attaches/detaches it. Code-registered Fields only. */
  readonly systemManaged?: boolean;
  /** **Decor Link** (ADR-0069): this Field's edges are presentation-only. `core.field.thumbnail` sets it. */
  readonly decor?: boolean;
}): Field {
  return Object.freeze(fieldSchema.parse(definition));
}

/**
 * Resolve a Field by its `id` → its definition (CONTEXT.md → Field, ADR-0054). `undefined` for an
 * unregistered id — a disabled plugin's Field, a deleted World-defined Field — which the effective-set
 * resolver drops (forward-only), leaving the document value as plain EntityDocument.
 */
export type FieldResolver = (id: string) => Field | undefined;

/**
 * The default Field ids (`fieldRefs`) an Entity Type declares, keyed by type id. `undefined` for a type
 * that declares none (a core type, an absent plugin) — it contributes nothing rather than throwing.
 */
export type TypeFieldRefsResolver = (typeId: string) => readonly string[] | undefined;

/**
 * The **effective Field set** of an Entity (CONTEXT.md → Entity, ADR-0054/ADR-0056/ADR-0057): its
 * **attached extras** — a registered Field key present in the EntityDocument that no current type defaults —
 * unioned with its types' default Fields (each type's `fieldRefs`, primary type first), every id resolved to
 * a {@link Field} and the whole deduped by `id`.
 *
 * Attachment is *derived*, not stored (ADR-0057): once a Field's id **is** its document key (ADR-0056), a
 * directly-attached Field is exactly a document key that resolves to a registered Field and is not already a
 * type default. A `null` value counts as present, so an attached-but-empty Field persists (its key sits in
 * the document as `null`); a discard deletes the key. The "minus the types' defaults" clause keeps a *filled*
 * type default in type-order rather than promoting it to an extra, and is what lets a filled default survive
 * a type removal as a first-class attachment while a blank one vanishes.
 *
 * Dedup is by id alone (ADR-0056): a key reaching the set via both the document and a type default resolves
 * to one entry (extras first, then types primary→later). Because a `namespace.id` key is unique, two
 * *different* Fields can never claim one key. A key that resolves to nothing is skipped — a foreign bare key,
 * a disabled plugin's Field, a deleted World Field — leaving the document value plain (forward-only). The one
 * resolution path (id → Field): a Type Definition names its default Fields by id (`fieldRefs`), never inline.
 *
 * The returned order is attached extras (document order) first, then types primary→later; display and View
 * ordering is a concern of the layer that consumes the set, not of resolution.
 */
export function resolveEffectiveFields(args: {
  readonly types: readonly string[];
  readonly doc: EntityDocument | undefined;
  readonly fieldResolver: FieldResolver;
  readonly typeFieldRefs: TypeFieldRefsResolver;
}): Field[] {
  const { types, doc, fieldResolver, typeFieldRefs } = args;
  // The types' default Field ids — a document key is an attached "extra" only when it is *not* one (ADR-0057).
  const typeDefaultIds = new Set<string>();
  for (const type of types) for (const id of typeFieldRefs(type) ?? []) typeDefaultIds.add(id);

  const byId = new Map<string, Field>();
  const consider = (id: string) => {
    const field = fieldResolver(id);
    if (field && !byId.has(field.id)) byId.set(field.id, field);
  };
  // Attached extras first (ADR-0057): a registered Field key in the document (null included) that no type
  // defaults, in document insertion order. Then each type's defaults in `types` order.
  for (const key of Object.keys(doc ?? {})) if (!typeDefaultIds.has(key)) consider(key);
  for (const type of types) for (const id of typeFieldRefs(type) ?? []) consider(id);
  return [...byId.values()];
}

/**
 * What one Field reads as: `type` (present but ill-typed), `unknown-data-type` — a Field naming a
 * **Structured Data Type** the host has not registered (ADR-0050) — or `required` (absent). The last is
 * advisory: an **Incomplete** reading on {@link FieldValidation.incomplete}, never in the errors array
 * (ADR-0074). `unknown-data-type` is a broken *declaration*, not a bad value: raised by
 * {@link unresolvedDataTypeErrors} where a Type is declared, never by the value gate.
 */
export interface FieldError {
  readonly key: string;
  readonly code: 'required' | 'type' | 'unknown-data-type';
}

/**
 * The outcome of {@link validateFields}, on two channels a caller must not conflate (ADR-0074):
 * `errors` are the shape violations and `ok` follows them alone; `incomplete` is the advisory reading of
 * the `required` Fields left unfilled, which flags a surface rather than refusing a write. A caller that
 * gates on absence too recombines the two itself.
 */
export interface FieldValidation {
  readonly ok: boolean;
  readonly errors: readonly FieldError[];
  readonly incomplete: readonly FieldError[];
}

/**
 * The **forward-only** validation gate (CONTEXT.md → Field, ADR-0048): validate a resolved Field set
 * against an Entity's EntityDocument. The rule is **shape violations are errors; absence is a hint**
 * (ADR-0074): a *present* value — required or not — must match its data-type, while a `required` Field
 * with no value reads as `incomplete` and never as an error. An absent optional Field is nothing at all,
 * and any EntityDocument key with no Field is ignored entirely (a Field is a lens, not a whitelist).
 *
 * The caller decides *when* to enforce it — active typed edits only, never on import or data at rest,
 * so already stored EntityDocument is never retroactively invalidated.
 *
 * A Field of a **Structured Data Type** validates against that data-type's own `valueSchema`, resolved
 * from the host-composed `dataTypes` (ADR-0050). One whose kind that set does not carry is *inert* — skipped,
 * its value left as plain EntityDocument, exactly as an absent plugin's Fields are; the unregistered kind is
 * rejected where the Type is declared instead ({@link unresolvedDataTypeErrors}).
 */
export function validateFields(
  fields: readonly Field[],
  doc: EntityDocument | undefined,
  dataTypes: StructuredDataTypeSet,
): FieldValidation {
  const errors: FieldError[] = [];
  const incomplete: FieldError[] = [];
  for (const field of fields) {
    const matches = valueMatcher(field.dataType, dataTypes);
    if (!matches) continue;
    const value = doc?.[field.id];
    if (isAbsent(value)) {
      if (field.required) incomplete.push({ key: field.id, code: 'required' });
      continue;
    }
    if (!matches(value)) errors.push({ key: field.id, code: 'type' });
  }
  return { ok: errors.length === 0, errors, incomplete };
}

/**
 * The value predicate a Field's data-type resolves to: the built-in type check, or a structured
 * data-type's own `valueSchema`. `undefined` when a structured kind resolves to nothing — no shape to
 * hold the value to, so the gate skips it.
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
 * not carry. Run where a Type is declared (a plugin type at startup, a **User-defined type** as a
 * World Owner saves it), never against an Entity's EntityDocument.
 */
export function unresolvedDataTypeErrors(fields: readonly Field[], dataTypes: StructuredDataTypeSet): FieldError[] {
  return fields.flatMap((field) =>
    isStructuredDataType(field.dataType) && !resolveStructuredDataType(dataTypes, field.dataType)
      ? [{ key: field.id, code: 'unknown-data-type' as const }]
      : [],
  );
}

/**
 * One denormalised **facetable** Field value (ADR-0048): the EntityDocument `key` it types, its canonical
 * string `value`, and a `num` — the numeric form of a `number` Field, else `null`. `num` lets a range
 * filter compare a number *as a number* (`cr >= 5`), while an enum/date/string compares its `value`
 * lexically (ISO dates sort correctly as text). Materialised on write and rebuilt by Reindex.
 */
export interface FieldFacetValue {
  readonly key: string;
  readonly value: string;
  readonly num: number | null;
}

/**
 * A Field's facet rows: a `list` maps each well-typed item, an `entityLink` yields its target id (the
 * facet filters by a stable id, not the mutable name), a scalar its one well-typed value. The scalar
 * counterpart to a **Structured Data Type**'s `harvestFacets`; {@link deriveDocumentState} composes both.
 */
export function facetItems(dataType: BuiltInDataType, raw: unknown): { value: string; num: number | null }[] {
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
 * Every Entity-Link Field value an Entity's EntityDocument carries, keyed by the Field. Only an `entityLink`
 * Field with a present, shape-valid value contributes (a blank or ill-typed one is skipped,
 * forward-only). Feeds {@link deriveDocumentState}.
 */
export function entityLinkFieldValues(
  fields: readonly Field[],
  doc: EntityDocument | undefined,
): { key: string; value: EntityLinkValue }[] {
  const out: { key: string; value: EntityLinkValue }[] = [];
  for (const field of fields) {
    if (field.dataType.kind !== 'entityLink') continue;
    const parsed = entityLinkValueSchema.safeParse(readField(doc, field));
    if (parsed.success) out.push({ key: field.id, value: parsed.data });
  }
  return out;
}

/**
 * Every Field of a **Structured Data Type** in a resolved set, paired with the data-type it resolves
 * to (ADR-0050). An unregistered kind drops out rather than throwing — nothing can render or harvest it.
 */
export function resolvedStructuredDataTypeFields(
  fields: readonly Field[],
  dataTypes: StructuredDataTypeSet,
): { field: Field; dataType: StructuredDataType }[] {
  const out: { field: Field; dataType: StructuredDataType }[] = [];
  for (const field of fields) {
    if (!isStructuredDataType(field.dataType)) continue;
    const dataType = resolveStructuredDataType(dataTypes, field.dataType);
    if (dataType) out.push({ field, dataType });
  }
  return out;
}

/**
 * A Field's effective **Vault Projection** slot (CONTEXT.md → Vault Projection, ADR-0051): the Field's
 * own override if it declares one, else the data-type's default. `undefined` when neither has an opinion
 * — a built-in Field with no override — which the vault layer treats as ordinary frontmatter.
 */
export function vaultSlotOf(field: FieldSchema, dataType: StructuredDataType | undefined): VaultSlot | undefined {
  return field.vault?.slot ?? dataType?.vault?.slot;
}

/**
 * One Entity-Link Field whose target-type constraint the write gate must check: the Field `key`, the
 * linked `entityId`, and the non-empty `targetTypes` the target's types must intersect. Only a
 * constrained Field (`targetTypes` non-empty) with a present value yields one. The caller resolves
 * each `entityId`'s actual types from the DB — a missing target has nothing to check.
 */
export interface EntityLinkConstraint {
  readonly key: string;
  readonly entityId: string;
  readonly targetTypes: readonly string[];
}

export function entityLinkConstraints(
  fields: readonly Field[],
  doc: EntityDocument | undefined,
): EntityLinkConstraint[] {
  const out: EntityLinkConstraint[] = [];
  for (const field of fields) {
    if (field.dataType.kind !== 'entityLink') continue;
    const targetTypes = field.dataType.targetTypes ?? [];
    if (targetTypes.length === 0) continue;
    const parsed = entityLinkValueSchema.safeParse(readField(doc, field));
    if (parsed.success) out.push({ key: field.id, entityId: parsed.data.entityId, targetTypes });
  }
  return out;
}

/**
 * The comparison a {@link FieldFilter} applies: `eq` membership, `neq` exclusion, or a `gte`/`lte`
 * range bound. Field exclusion is a fourth op rather than a second param because this grammar already
 * carries its own operator, and an older build drops an unrecognised one rather than 400ing (ADR-0081).
 */
export type FieldFilterOp = 'eq' | 'neq' | 'gte' | 'lte';

const FIELD_FILTER_OPS: ReadonlySet<string> = new Set<FieldFilterOp>(['eq', 'neq', 'gte', 'lte']);

/**
 * One filter-by-Field constraint (ADR-0048): the EntityDocument `key`, an `op`, and the compared `value`.
 * `eq` on the same key OR together (enum/list membership); `gte`/`lte` on the same key form a range;
 * different keys AND. `neq` **vetoes** — it beats any `eq` on the same value and accumulates with its
 * peers, and an Entity carrying no value for the key survives it (ADR-0081). Wire form is `key:op:value`.
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

/** Read a Field's value straight off the EntityDocument map at `field.id` — the lens, so it never copies or coerces. */
export function readField(doc: EntityDocument | undefined, field: Field): unknown {
  return doc?.[field.id];
}

/**
 * Write a Field's value back into the EntityDocument map at `field.id`, returning a fresh map. An emptied
 * value clears the key — a cleared Field is absent, not blank — leaving every sibling EntityDocument entry
 * untouched.
 */
export function writeField(doc: EntityDocument | undefined, field: Field, value: unknown): EntityDocument {
  const next: EntityDocument = { ...(doc ?? {}) };
  if (isEmptyFieldValue(value)) delete next[field.id];
  else next[field.id] = value;
  return next;
}

/**
 * {@link writeField}'s set-or-clear semantics applied *in place* on a draft of the EntityDocument map — for a
 * View editing the body through Immer's `mutate`, where the body **is** the map (ADR-0051) and the draft
 * root cannot be reassigned. An emptied value deletes the key; else it sets it.
 */
export function writeFieldInPlace(draft: EntityDocument, field: Field, value: unknown): void {
  const next = writeField(draft, field, value);
  if (field.id in next) draft[field.id] = next[field.id];
  else delete draft[field.id];
}

/** Absent for the *required* check: `undefined`/`null` (an absent key), not a present-but-empty value. */
function isAbsent(value: unknown): boolean {
  return value === undefined || value === null;
}

/**
 * Whether a Field value reads as emptied: absent (`undefined`/`null`), a blank string, or an empty list.
 * {@link writeField} clears the key on it; the generic Field editor writes `null` instead, so *clearing* a
 * value keeps the Field attached (ADR-0057) while *discarding* it (a document-key delete) detaches it.
 */
export function isEmptyFieldValue(value: unknown): boolean {
  return isAbsent(value) || value === '' || (Array.isArray(value) && value.length === 0);
}

/**
 * Whether `value` inhabits a *built-in* `dataType`. A structured data-type rides its own `valueSchema`
 * instead ({@link valueMatcher}), so this switch stays closed and exhaustive.
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
 * An ISO-8601 date (`YYYY-MM-DD`) with an optional time part. EntityDocument dates arrive as strings
 * (frontmatter YAML re-serialized to JSON, ADR-0033), so a Field date is a string, not a `Date`. The
 * regex fences out garbage; the parse then rejects an impossible calendar date the shape would admit.
 */
function isIsoDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/.test(value)) return false;
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  // Round-trip the date part through UTC: a rolled-over day (e.g. 02-30 → 03-02) proves it was invalid.
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
