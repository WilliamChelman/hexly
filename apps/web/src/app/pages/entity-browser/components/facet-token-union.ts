import { FacetTokenCategory, FacetTokenValues, FieldFilter, ParsedFacetQuery } from '@hexly/domain';
import { ActiveFacets, FieldRangeBound, FieldSelection, QueryOwnedFacets } from './facet-rail.component';
import { boundOf, foldFieldFilters, pruneField } from './field-facet-url';

/** The categories both stores speak, in the rail's own order. */
const CATEGORIES = ['type', 'tag', 'visibility', 'container'] as const satisfies readonly FacetTokenCategory[];

/** A rail store's values for one polarity — `container` and the excluding half are both optional there. */
type RailValues = Partial<Record<FacetTokenCategory, readonly string[]>>;

/**
 * The one filter state, `parse(text) ∪ railState` (ADR-0082) — read together here for the wire and the
 * rail. Where both stores name a value the text wins and the rail's entry drops, so a contradiction
 * resolves at the moment of typing and each value keeps one visual state.
 */
export function unionFacets(parsed: ParsedFacetQuery, rail: ActiveFacets): ActiveFacets {
  const merge = (typed: FacetTokenValues, clicked: RailValues): Record<FacetTokenCategory, readonly string[]> => {
    const merged: Record<FacetTokenCategory, readonly string[]> = { type: [], tag: [], visibility: [], container: [] };
    for (const category of CATEGORIES) {
      // Either polarity in the text takes the value off the rail: the contradiction is settled here.
      const named = new Set([...parsed.include[category], ...parsed.exclude[category]]);
      merged[category] = [...typed[category], ...(clicked[category] ?? []).filter((value) => !named.has(value))];
    }
    return merged;
  };

  return {
    ...merge(parsed.include, rail),
    excluded: merge(parsed.exclude, rail.excluded ?? {}),
    fields: unionFields(parsed.fields, rail.fields),
  };
}

/**
 * Which of the union's controls came from the text (ADR-0082), in either polarity — a bound counted per
 * input, not per Field: `$cr:>=5` owns that Field's minimum and leaves its maximum the rail's to set.
 */
export function queryOwnedFacets(parsed: ParsedFacetQuery): QueryOwnedFacets {
  const categories: Partial<Record<FacetTokenCategory, readonly string[]>> = {};
  for (const category of CATEGORIES) categories[category] = [...parsed.include[category], ...parsed.exclude[category]];
  const fields: Record<string, string[]> = {};
  const bounds: Record<string, FieldRangeBound[]> = {};
  for (const filter of parsed.fields) {
    // The same op→input mapping {@link unionFields} renders through, so what is marked owned is what shows.
    const bound = boundOf(filter.op);
    if (!bound) (fields[filter.key] ??= []).push(filter.value);
    else if (!(bounds[filter.key] ??= []).includes(bound)) bounds[filter.key].push(bound);
  }
  return { categories, fields, bounds };
}

/** The Field half of the union: the same rule, per Facet key — a value the text names drops from the
 * rail, and a bound the text names replaces the rail's. */
function unionFields(
  parsed: readonly FieldFilter[],
  rail: Readonly<Record<string, FieldSelection>>,
): Record<string, FieldSelection> {
  const typed = foldFieldFilters(parsed);
  const fields: Record<string, FieldSelection> = {};
  for (const key of new Set([...Object.keys(rail), ...Object.keys(typed)])) {
    const text = typed[key] ?? {};
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
