import { Observable, catchError, map, of } from 'rxjs';
import { ENTITY_LIST_MAX_LIMIT, EntitySummary } from '@hexly/domain';
import { EntitiesClient } from '../services/entities.client';

/**
 * The shared server-side Entity search (ADR-0025): trim the query, cap the page
 * at the read surface's max, and swallow errors to an empty list so a picker or
 * the Command Palette never breaks on a failed search. Callers that must not hit
 * the server on a blank query guard that themselves before calling.
 */
// TODO resource with source q signal + debounce
export function searchEntities(
  client: EntitiesClient,
  query: string,
): Observable<EntitySummary[]> {
  return client.list({ q: query.trim(), limit: ENTITY_LIST_MAX_LIMIT }).pipe(
    map((page) => page.items),
    catchError(() => of<EntitySummary[]>([])),
  );
}
