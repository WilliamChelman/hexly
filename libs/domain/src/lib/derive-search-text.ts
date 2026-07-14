/**
 * The searchable text an Entity's document carries, for the full-text index (ADR-0035, ADR-0051).
 * The write path derives it on every save, and Reindex rebuilds it from the stored document.
 */

import { FieldSchema, EntityDocument, readField, resolvedStructuredFields } from './field';
import { joinSearchText } from './join-search-text';
import type { StructuredDataTypeSet } from './structured-data-type';

/**
 * The text each **Structured Field**'s value carries — a document's prose, a grid's Hex and Region
 * names — asked of the data-type the host registered.
 *
 * `doc` is the EntityDocument map, `fields` the Entity's resolved Field schema set ({@link resolveFields})
 * and `dataTypes` the host-composed **Structured Field** set. A caller with no type context passes
 * `[]` and the empty set, and gets nothing. A data-type declaring no `extractText` — or a value at
 * rest it cannot parse — contributes nothing, never a throw. Prose is no special case: it reaches
 * this loop as `core.rich-content`, exactly as a grid does (ADR-0051).
 */
export function deriveSearchText(
  doc: EntityDocument,
  fields: readonly FieldSchema[],
  dataTypes: StructuredDataTypeSet,
): string {
  const parts: (string | undefined)[] = [];
  for (const { field, dataType } of resolvedStructuredFields(fields, dataTypes))
    parts.push(dataType.extractText?.(readField(doc, field)));
  return joinSearchText(parts);
}
