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
 * value reader/writer over the Metadata map. A typed **Entity Link** field
 * (ADR-0023) is a later ticket — the data-types here are scalar / enum / date / list.
 */

import { z } from 'zod';

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
const listType = z.object({ kind: z.literal('list'), of: scalarDataTypeSchema });

/**
 * The Field data-type: a scalar (`string`/`number`/`boolean`/`date`), an `enum`
 * over a closed option set, or a `list` of any of those. The open, code-known set
 * a Field declares; a typed `entityLink` joins it in its own ticket (ADR-0048).
 */
export const fieldDataTypeSchema = z.discriminatedUnion('kind', [
  stringType,
  numberType,
  booleanType,
  dateType,
  enumType,
  listType,
]);

export type FieldDataType = z.infer<typeof fieldDataTypeSchema>;

/**
 * One Field's declaration in a Type Definition's schema: the Metadata `key` it
 * types, a human `label`, its `dataType`, whether it is `required`, and whether it
 * is `facetable` (surfaced as a per-type facet in the Entity Browser, ADR-0035).
 * `required` and `facetable` default to false so a terse `{ key, label, dataType }`
 * declares an optional, non-facetable Field.
 */
export const fieldSchemaSchema = z.object({
  key: z.string().trim().min(1),
  label: z.string().trim().min(1),
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

/** Why one Field's value failed validation: `required` (absent) or `type` (present but ill-typed). */
export interface FieldError {
  readonly key: string;
  readonly code: 'required' | 'type';
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
 */
export function validateFields(
  fields: readonly FieldSchema[],
  metadata: Metadata | undefined,
): FieldValidation {
  const errors: FieldError[] = [];
  for (const field of fields) {
    const value = metadata?.[field.key];
    if (isAbsent(value)) {
      if (field.required) errors.push({ key: field.key, code: 'required' });
      continue;
    }
    if (!matchesDataType(field.dataType, value)) errors.push({ key: field.key, code: 'type' });
  }
  return { ok: errors.length === 0, errors };
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

/** Whether `value` inhabits `dataType` — the per-kind type check the forward-only gate rides. */
function matchesDataType(dataType: FieldDataType, value: unknown): boolean {
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
      return Array.isArray(value) && value.every((item) => matchesDataType(dataType.of, item));
  }
}

/**
 * An ISO-8601 date (`YYYY-MM-DD`) with an optional time part. Metadata dates arrive
 * as strings (frontmatter YAML re-serialized to JSON, ADR-0033), so a Field date is
 * a string, not a `Date`. The shape regex fences out garbage before the parse, and
 * the parse rejects an impossible calendar date the shape alone would admit.
 */
function isIsoDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/.test(value))
    return false;
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  // Round-trip the date part through UTC: a rolled-over day (e.g. 02-30 → 03-02) proves it was invalid.
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}
