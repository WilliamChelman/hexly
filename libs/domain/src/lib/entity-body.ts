/**
 * Minting an Entity body from the **Fields** its Entity Types declare (ADR-0050).
 */

import { emptyContent, EntityBody } from './entity';
import { FieldSchema, Metadata, readField, resolvedStructuredFields } from './field';
import { NO_STRUCTURED_DATA_TYPES, StructuredDataTypeSet } from './structured-data-type';

/**
 * An empty body for a fresh Entity: blank Content, plus the defaults `fields` declare. With no
 * arguments it yields Content and nothing else.
 */
export function emptyEntityBody(
  fields: readonly FieldSchema[] = [],
  dataTypes: StructuredDataTypeSet = NO_STRUCTURED_DATA_TYPES,
): EntityBody {
  return withFieldDefaults({ content: emptyContent() }, fields, dataTypes);
}

/**
 * Mint the default value of every declared Field that has none — the reconcile a *type change* runs.
 * Only a **Structured Field** declares a default ({@link StructuredDataType.empty}); for a `string`
 * or a `number`, absent *is* unset.
 *
 * Adds, never overwrites: a present value stays, however malformed (validation is forward-only), and
 * dropping a type never strips its values. Returns the same reference when there is nothing to mint,
 * so a caller's dirty-check by reference stays sound.
 */
export function withFieldDefaults(
  body: EntityBody,
  fields: readonly FieldSchema[],
  dataTypes: StructuredDataTypeSet,
): EntityBody {
  let metadata: Metadata | undefined = body.metadata;
  for (const { field, dataType } of resolvedStructuredFields(fields, dataTypes)) {
    if (readField(metadata, field) !== undefined) continue;
    // Not `writeField`: it clears a key whose value reads as emptied, so a data-type whose `empty()`
    // is `[]` (a blank timeline) would mint nothing.
    metadata = { ...(metadata ?? {}), [field.key]: dataType.empty() };
  }
  return metadata === body.metadata ? body : { ...body, metadata };
}
