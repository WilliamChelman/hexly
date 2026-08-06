import { FacetTokenCategory, FacetTokenValues, FieldFilter, ParsedFacetQuery } from '@hexly/domain';
import { ActiveFacets, FieldSelection, QueryOwnedFacets } from './facet-rail.component';
import { foldFieldFilters, pruneField } from './field-facet-url';

/** The categories both stores speak, in the rail's own order. */
const CATEGORIES = ['type', 'tag', 'visibility', 'container'] as const satisfies readonly FacetTokenCategory[];

/** A rail store's values for one polarity — `container` and the excluding half are both optional there. */
type RailValues = Partial<Record<FacetTokenCategory, readonly string[]>>;

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
 * Which of the rendered values the **text** owns (ADR-0082, #425) — the half of the union the rail
 * marks as query-owned, and the half a click deletes a token for rather than toggling. Either polarity
 * counts: a value has one visual state whichever way the box named it.
 */
export function queryOwnedFacets(parsed: ParsedFacetQuery): QueryOwnedFacets {
  const categories: Partial<Record<FacetTokenCategory, readonly string[]>> = {};
  for (const category of CATEGORIES) categories[category] = [...parsed.include[category], ...parsed.exclude[category]];
  const fields: Record<string, string[]> = {};
  // A bound is left out: `$cr:>=5` lights no row, so there is no row to click off.
  for (const filter of parsed.fields)
    if (filter.op === 'eq' || filter.op === 'neq') (fields[filter.key] ??= []).push(filter.value);
  return { categories, fields };
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
