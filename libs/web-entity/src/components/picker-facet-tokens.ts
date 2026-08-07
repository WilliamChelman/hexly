import { Signal, computed, inject } from '@angular/core';
import { EntityType, FacetKeySet, ParsedFacetQuery, Visibility, parseFacetQuery } from '@hexly/domain';
import { ENTITY_TYPES } from '../models/entity-types';
import { LinkTargetNarrowing } from './link-target-read';

/** A picker's box, read as **Facet Tokens**: the vocabulary it offers and what its text currently means. */
export interface PickerFacetTokens {
  /** The keys the box offers on `$` and resolves against — one set, read by the parser and the typeahead. */
  readonly keys: Signal<FacetKeySet>;
  /** The parse of the raw box: the tokens as filters, the free text left over, the keys that missed. */
  readonly parsed: Signal<ParsedFacetQuery>;
  /** Those filters as list params, for a picker to spread its own pins over (ADR-0079). */
  readonly narrowing: Signal<LinkTargetNarrowing>;
}

/**
 * A picker's box read as **Facet Tokens** (ADR-0082) — no rail here, so the text is the only store.
 *
 * The vocabulary is the client registry's, synchronously, minus two names a picker cannot honour: `in`,
 * the Container being the chips' single-select (ADR-0080), and `type` wherever {@link canFilterType} is
 * false — the wire's `type` ORs, so a token could only widen past a pin, and a miss is stated instead.
 */
export function pickerFacetTokens(raw: () => string, canFilterType: () => boolean = () => true): PickerFacetTokens {
  const types = inject(ENTITY_TYPES);
  const keys = computed<FacetKeySet>(() => ({
    reserved: canFilterType() ? ['type', 'tag', 'visibility'] : ['tag', 'visibility'],
    fields: types.facetKeys(),
  }));
  const parsed = computed(() => parseFacetQuery(raw(), keys()));
  const narrowing = computed<LinkTargetNarrowing>(() => facetTokenNarrowing(parsed()));
  return { keys, parsed, narrowing };
}

/**
 * One parsed box as the list params it names — the residual full-text `q`, each category in both
 * polarities (ADR-0081), and the Facet keys as the `key:op:value` tokens the `field` param already
 * speaks. Absent keys for empty sets, so a picker's pins spread over it without a branch.
 */
export function facetTokenNarrowing(parsed: ParsedFacetQuery): LinkTargetNarrowing {
  const { include, exclude } = parsed;
  const field = parsed.fields.map((f) => `${f.key}:${f.op}:${f.value}`);
  return {
    ...(parsed.text ? { q: parsed.text } : {}),
    ...(include.type.length ? { type: [...include.type] as EntityType[] } : {}),
    ...(include.tag.length ? { tag: [...include.tag] } : {}),
    ...(include.visibility.length ? { visibility: [...include.visibility] as Visibility[] } : {}),
    ...(field.length ? { field } : {}),
    ...(exclude.type.length ? { excludeType: [...exclude.type] as EntityType[] } : {}),
    ...(exclude.tag.length ? { excludeTag: [...exclude.tag] } : {}),
    ...(exclude.visibility.length ? { excludeVisibility: [...exclude.visibility] as Visibility[] } : {}),
  };
}
