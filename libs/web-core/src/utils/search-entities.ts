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
 * The shared server-side Entity search (ADR-0025). A blank query still hits the server:
 * callers that must not search on blank guard that themselves. Errors surface as an empty
 * list, never a stream error.
 *
 * Repeated queries paint from a small per-stream cache, then revalidate: results replace
 * the cached ones only if they changed (stale-while-revalidate), and a failed revalidation
 * keeps the cached results. Take-first consumers get the cached paint and skip revalidation.
 */
export function searchEntities(client: EntitiesClient, query$: Observable<string>): Observable<EntitySummary[]> {
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
          if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
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
      return e.id === o.id && e.name === o.name && e.types[0] === o.types[0] && e.worldId === o.worldId;
    })
  );
}
