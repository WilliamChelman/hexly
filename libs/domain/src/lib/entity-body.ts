/**
 * Minting an Entity body from the **Fields** its Entity Types declare (ADR-0050, ADR-0051). The body
 * **is** the Metadata map, so minting adds keys to it directly — there is no wrapper and no Content
 * base to seed.
 */

import { FieldSchema, Metadata, readField, resolvedStructuredFields } from './field';
import { NO_STRUCTURED_DATA_TYPES, StructuredDataTypeSet } from './structured-data-type';

/**
 * An empty body for a fresh Entity: the defaults `fields` declare and nothing else. With no arguments
 * it yields the empty map — a bodyless placeholder a load clears the canvas to.
 */
export function emptyEntityBody(
  fields: readonly FieldSchema[] = [],
  dataTypes: StructuredDataTypeSet = NO_STRUCTURED_DATA_TYPES,
): Metadata {
  return withFieldDefaults({}, fields, dataTypes);
}

/**
 * Mint the default value of every declared Field that has none — the reconcile a *type change* runs.
 * Only a **Structured Field** declares a default ({@link StructuredDataType.empty}); for a `string`
 * or a `number`, absent *is* unset. Prose (`core.rich-content`) mints through this same path.
 *
 * Adds, never overwrites: a present value stays, however malformed (validation is forward-only), and
 * dropping a type never strips its values. Returns the same reference when there is nothing to mint,
 * so a caller's dirty-check by reference stays sound.
 */
export function withFieldDefaults(
  body: Metadata,
  fields: readonly FieldSchema[],
  dataTypes: StructuredDataTypeSet,
): Metadata {
  let next: Metadata | undefined;
  for (const { field, dataType } of resolvedStructuredFields(fields, dataTypes)) {
    if (readField(next ?? body, field) !== undefined) continue;
    // Not `writeField`: it clears a key whose value reads as emptied, so a data-type whose `empty()`
    // is `[]` (a blank timeline) would mint nothing.
    next = { ...(next ?? body), [field.key]: dataType.empty() };
  }
  return next ?? body;
}
