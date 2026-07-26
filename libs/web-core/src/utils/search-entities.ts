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

/** Per-call knobs; `thumbnails` opts the read into `thumbnails=1` so each result carries a `thumbnailUrl`
 * (ADR-0066) — surfaces that render a preview tile (the Command Palette) set it, plain pickers don't. */
export interface SearchEntitiesOptions {
  readonly thumbnails?: boolean;
  /**
   * The stale-while-revalidate store, supplied by a caller that must be able to *drop* it: a
   * take-first consumer never revalidates, so one that writes an Entity its own next search has to
   * find (Inline Creation, ADR-0073) clears this. Omitted, the stream owns a private one.
   */
  readonly cache?: Map<string, EntitySummary[]>;
}

/**
 * The shared server-side Entity search (ADR-0025). A blank query still hits the server:
 * callers that must not search on blank guard that themselves. Errors surface as an empty
 * list, never a stream error.
 *
 * Repeated queries paint from a small per-stream cache, then revalidate: results replace
 * the cached ones only if they changed (stale-while-revalidate), and a failed revalidation
 * keeps the cached results. Take-first consumers get the cached paint and skip revalidation.
 */
export function searchEntities(
  client: EntitiesClient,
  query$: Observable<string>,
  opts: SearchEntitiesOptions = {},
): Observable<EntitySummary[]> {
  // Per call, so it lives with the stream (a per-surface resolver's cache dies with
  // the surface; the app-lifetime palette's persists but self-heals via revalidation).
  const cache = opts.cache ?? new Map<string, EntitySummary[]>();
  return query$.pipe(
    debounceTime(SEARCH_DEBOUNCE_MS),
    map((query) => query.trim()),
    switchMap((q) => {
      const cached = cache.get(q);
      // Deferred so a take-first consumer that unsubscribes on the cached paint
      // never fires the request at all (see below).
      // includeHidden: this helper backs pickers, not browses, so an Asset stays findable by name
      // (ADR-0065) — ranked below ordinary matches server-side.
      const fresh$ = defer(() =>
        client.list({ q, limit: SEARCH_LIMIT, includeHidden: true, ...(opts.thumbnails ? { thumbnails: true } : {}) }),
      ).pipe(
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

/** Equal on the fields a picker renders/uses — so a rename (name) or a re-minted thumbnail
 * (thumbnailUrl, ADR-0066) revalidates in. thumbnailUrl is undefined for non-thumbnail reads, so
 * the extra comparison is a no-op there. */
function sameResults(a: EntitySummary[], b: EntitySummary[]): boolean {
  return (
    a.length === b.length &&
    a.every((e, i) => {
      const o = b[i];
      return (
        e.id === o.id &&
        e.name === o.name &&
        e.types[0] === o.types[0] &&
        e.worldId === o.worldId &&
        e.thumbnailUrl === o.thumbnailUrl
      );
    })
  );
}
