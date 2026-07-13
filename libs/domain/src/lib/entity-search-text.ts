/**
 * The searchable text an Entity's document carries, for the full-text index (ADR-0035, ADR-0051).
 * The write path derives it on every save, and Reindex rebuilds it from the stored document.
 */

import { extractText } from './content/extract-text';
import { EntityBody } from './entity';
import { FieldSchema, readField, resolvedStructuredFields } from './field';
import { joinSearchText } from './search-text';
import type { StructuredDataTypeSet } from './structured-data-type';

/**
 * The Content's prose, plus the text each **Structured Field**'s value carries (a grid's Hex and
 * Region names), asked of the data-type the host registered.
 *
 * `fields` is the Entity's resolved Field schema set ({@link resolveFields}) and `dataTypes` the
 * host-composed **Structured Field** set. A caller with no type context passes `[]` and the empty
 * set, and gets the prose alone. A data-type declaring no `extractText` — or a value at rest it
 * cannot parse — contributes nothing, never a throw.
 *
 * `body.content` is read here only because prose is still stored at the body root. ADR-0051's
 * collapse must delete that line as it makes prose a `core.rich-content` Field, or the loop below
 * indexes it a second time.
 */
export function deriveSearchText(
  body: EntityBody,
  fields: readonly FieldSchema[],
  dataTypes: StructuredDataTypeSet,
): string {
  const parts: (string | undefined)[] = [extractText(body.content)];
  for (const { field, dataType } of resolvedStructuredFields(fields, dataTypes))
    parts.push(dataType.extractText?.(readField(body.metadata, field)));
  return joinSearchText(parts);
}
