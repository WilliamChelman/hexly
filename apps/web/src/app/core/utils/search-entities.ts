import {
  EMPTY,
  Observable,
  catchError,
  debounceTime,
  defer,
  distinctUntilChanged,
  map,
  of,
  startWith,
  switchMap,
  tap,
} from 'rxjs';
import { EntitySummary } from '@hexly/domain';
import { EntitiesClient } from '../services/entities.client';

/** Autocomplete page cap — a picker only shows a handful of rows at a time. */
const SEARCH_LIMIT = 20;
/** Trailing-debounce window so fast typing fires one search, not one per key. */
const SEARCH_DEBOUNCE_MS = 150;
/** Recent queries kept per stream so backspace/retype paints instantly (see cache). */
const CACHE_LIMIT = 50;

/**
 * The shared server-side Entity search (ADR-0025): debounce the query stream,
 * trim it, switch to the latest search (cancelling superseded ones), cap the page
 * for autocomplete, and swallow errors to an empty list so a picker or the Command
 * Palette never breaks on a failed search. Callers push queries as they type;
 * those that must not hit the server on a blank query guard that themselves.
 *
 * Repeated queries (backspacing, retyping) paint instantly from a small per-stream
 * cache, then revalidate: the server is queried anyway and the results replace the
 * cached ones only if they changed (stale-while-revalidate), so a rename shows up
 * without ever blanking the list. A failed revalidation keeps the cached results.
 * Take-first consumers (a `firstValueFrom` picker) get the cached paint and skip
 * revalidation — fine for a short-lived per-surface stream.
 */
export function searchEntities(
  client: EntitiesClient,
  query$: Observable<string>,
): Observable<EntitySummary[]> {
  // Per call, so it lives with the stream (a per-surface resolver's cache dies with
  // the surface; the app-lifetime palette's persists but self-heals via revalidation).
  const cache = new Map<string, EntitySummary[]>();
  return query$.pipe(
    debounceTime(SEARCH_DEBOUNCE_MS),
    map((query) => query.trim()),
    switchMap((q) => {
      const cached = cache.get(q);
      // Deferred so a take-first consumer that unsubscribes on the cached paint
      // never fires the request at all (see below).
      const fresh$ = defer(() => client.list({ q, limit: SEARCH_LIMIT })).pipe(
        map((page) => page.items),
        // tap only runs on a successful emission, so failed searches never cache;
        // refresh insertion order and evict the oldest past the cap.
        tap((items) => {
          cache.set(q, items);
          if (cache.size > CACHE_LIMIT)
            cache.delete(cache.keys().next().value as string);
        }),
      );
      if (!cached) return fresh$.pipe(catchError(() => of<EntitySummary[]>([])));
      // Show the cache now, revalidate, replace only if changed. A failed
      // revalidation completes silently, leaving the cached results on screen.
      return fresh$.pipe(
        catchError(() => EMPTY),
        startWith(cached),
        distinctUntilChanged(sameResults),
      );
    }),
  );
}

/** Equal on the fields a picker renders/uses — so a rename (name) revalidates in. */
function sameResults(a: EntitySummary[], b: EntitySummary[]): boolean {
  return (
    a.length === b.length &&
    a.every((e, i) => {
      const o = b[i];
      return (
        e.id === o.id &&
        e.name === o.name &&
        e.type === o.type &&
        e.worldId === o.worldId
      );
    })
  );
}
