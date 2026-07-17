import { TranslocoService } from '@jsverse/transloco';

/**
 * The search-and-source filter both settings pickers apply: a case-insensitive query over the item's
 * `texts` plus an optional exact source match. Shared so the datatype and Field-ref pickers narrow alike.
 */
export function matchesSearchAndSource<T extends { source: string }>(
  item: T,
  filter: { query: string; source: string },
  texts: (item: T) => readonly string[],
): boolean {
  const q = filter.query.trim().toLowerCase();
  const matchesSource = !filter.source || item.source === filter.source;
  const matchesQuery = !q || texts(item).some((text) => text.toLowerCase().includes(q));
  return matchesSource && matchesQuery;
}

/**
 * Resolve a transloco key inside a `computed`, re-reading `activeLang()` so the label recomputes on a
 * language switch (transloco's pipe-less imperative `translate` doesn't track the active language itself).
 */
export function activeLangLabel(transloco: TranslocoService, key: string): string {
  transloco.activeLang();
  return transloco.translate(key);
}
