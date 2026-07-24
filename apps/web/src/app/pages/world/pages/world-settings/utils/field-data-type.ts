import { FieldDataType, isStructuredKind } from '@hexly/domain';

/**
 * The built-in Data Types the code-less authoring forms offer — the subset a World Owner needs
 * (#191, #230). Shared by the World Fields editor and the World Types editor's inline new-Field
 * sub-form, so a new built-in (or a change to enum-option parsing) is authored in one place.
 */
export const BUILT_IN_KINDS = ['string', 'number', 'boolean', 'date', 'enum'] as const;
export type BuiltInKind = (typeof BUILT_IN_KINDS)[number];

/**
 * A form's picked `kind` (+ an enum's comma-separated `options`) → a {@link FieldDataType}. A `kind`
 * left untouched hands back the `stored` data-type verbatim, so a `list`'s item type or an
 * `entityLink`'s target-type constraint (authored through the API, not this form) survives a round trip.
 */
export function toFieldDataType(kind: string, options: string, stored?: FieldDataType): FieldDataType {
  if (kind === 'enum')
    return {
      kind: 'enum',
      options: options
        .split(',')
        .map((option) => option.trim())
        .filter(Boolean),
    };
  if (stored?.kind === kind) return stored;
  if (isStructuredKind(kind)) return { kind };
  // The remaining built-ins the picker offers are the scalars — one literal kind each, no payload.
  return { kind: kind as Exclude<BuiltInKind, 'enum'> };
}

/**
 * A Data Type's display name: a built-in's translated label (under `builtInPrefix`), a structured
 * one's `labelKey`, else the raw kind. `structuredLabelKeys` maps a structured kind → its transloco key.
 */
export function dataTypeLabel(
  kind: string,
  structuredLabelKeys: ReadonlyMap<string, string>,
  translate: (key: string) => string,
  builtInPrefix: string,
): string {
  if ((BUILT_IN_KINDS as readonly string[]).includes(kind)) return translate(`${builtInPrefix}.${kind}`);
  const labelKey = structuredLabelKeys.get(kind);
  return labelKey ? translate(labelKey) : kind;
}
