import { FacetTokenCategory, FieldFilter, ParsedFacetQuery } from '@hexly/domain';
import { ActiveFacets, FieldSelection } from './facet-rail.component';
import { pruneField } from './field-facet-url';

/**
 * The one filter state, `parse(text) ∪ railState` (ADR-0082). A typed Facet lives in the text and a
 * clicked one lives in the rail; this is where the two stores are read together — for the wire and for
 * the rail, which renders the union so every applied filter is visible in one place.
 *
 * Where both stores name the same value, **the text wins** and the rail's entry is dropped, so a
 * contradiction resolves visibly at the moment of typing rather than as a silent empty result set —
 * and each value keeps exactly one visual state.
 */
export function unionFacets(parsed: ParsedFacetQuery, rail: ActiveFacets): ActiveFacets {
  const railExcluded = rail.excluded ?? {};
  const merge = (category: FacetTokenCategory, own: readonly string[], railValues: readonly string[] = []) => {
    const named = new Set([...parsed.include[category], ...parsed.exclude[category]]);
    return [...own, ...railValues.filter((value) => !named.has(value))];
  };
  return {
    type: merge('type', parsed.include.type, rail.type),
    tag: merge('tag', parsed.include.tag, rail.tag),
    visibility: merge('visibility', parsed.include.visibility, rail.visibility),
    container: merge('container', parsed.include.container, rail.container),
    excluded: {
      type: merge('type', parsed.exclude.type, railExcluded.type),
      tag: merge('tag', parsed.exclude.tag, railExcluded.tag),
      visibility: merge('visibility', parsed.exclude.visibility, railExcluded.visibility),
      container: merge('container', parsed.exclude.container, railExcluded.container),
    },
    fields: unionFields(parsed.fields, rail.fields),
  };
}

/** The Field half of the union: the same rule, per Facet key — a value the text names drops from the
 * rail, and a bound the text names replaces the rail's. */
function unionFields(
  parsed: readonly FieldFilter[],
  rail: Readonly<Record<string, FieldSelection>>,
): Record<string, FieldSelection> {
  const typed = new Map<string, FieldSelection>();
  for (const filter of parsed) {
    const sel = typed.get(filter.key) ?? {};
    if (filter.op === 'eq') typed.set(filter.key, { ...sel, values: [...(sel.values ?? []), filter.value] });
    else if (filter.op === 'neq') typed.set(filter.key, { ...sel, excluded: [...(sel.excluded ?? []), filter.value] });
    else typed.set(filter.key, { ...sel, [filter.op]: filter.value });
  }

  const fields: Record<string, FieldSelection> = {};
  for (const key of new Set([...Object.keys(rail), ...typed.keys()])) {
    const text = typed.get(key) ?? {};
    const clicked = rail[key] ?? {};
    const named = new Set([...(text.values ?? []), ...(text.excluded ?? [])]);
    const keep = (values: readonly string[] | undefined) => (values ?? []).filter((value) => !named.has(value));
    const pruned = pruneField({
      values: [...(text.values ?? []), ...keep(clicked.values)],
      excluded: [...(text.excluded ?? []), ...keep(clicked.excluded)],
      gte: text.gte ?? clicked.gte,
      lte: text.lte ?? clicked.lte,
    });
    if (pruned) fields[key] = pruned;
  }
  return fields;
}
