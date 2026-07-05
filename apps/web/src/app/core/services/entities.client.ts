import {
  HttpClient,
  HttpErrorResponse,
  HttpParams,
} from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { catchError, map, Observable, of, throwError } from 'rxjs';
import {
  EntityBody,
  EntityDetail,
  EntityFacets,
  EntityListQuery,
  EntityPage,
  EntitySaveOutcome,
  EntityType,
  Visibility,
} from '@hexly/domain';

export type EntityListParams = Partial<EntityListQuery>;

/** The subset of list params the Facet-count read narrows against (#155) — no paging. */
export type EntityFacetParams = Pick<
  EntityListParams,
  'q' | 'type' | 'tag' | 'visibility' | 'worldId'
>;

/**
 * HTTP client for the entities API (ADR-0018, ADR-0005).
 * Stateless: every call is a round trip; open-entity/conflict state lives in EntitySession.
 */
@Injectable({ providedIn: 'root' })
export class EntitiesClient {
  private readonly http = inject(HttpClient);

  list(opts: EntityListParams = {}): Observable<EntityPage> {
    let params = facetParams(opts);
    // `ids` repeats in query string; cursor/limit are single-valued paging.
    for (const id of opts.ids ?? []) params = params.append('ids', id);
    if (opts.cursor) params = params.set('cursor', opts.cursor);
    if (opts.limit !== undefined) params = params.set('limit', opts.limit);
    return this.http.get<EntityPage>('/api/entities', { params });
  }

  /** Facet-rail counts under the active filters (#155), drilled down server-side (ADR-0035). */
  facets(opts: EntityFacetParams = {}): Observable<EntityFacets> {
    return this.http.get<EntityFacets>('/api/entities/facets', {
      params: facetParams(opts),
    });
  }

  /**
   * Patch an Entity's metadata — name and/or Visibility (ADR-0037, #160). One PATCH for
   * both: metadata never conflicts with an in-progress save. Owner-gated server-side.
   */
  patch(
    id: string,
    changes: { name?: string; visibility?: Visibility },
  ): Observable<EntityDetail> {
    return this.http.patch<EntityDetail>(`/api/entities/${id}`, changes);
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`/api/entities/${id}`);
  }

  /** The Entity's ownership set — Owner user ids (ADR-0037, #158). Owner-only server-side. */
  owners(id: string): Observable<string[]> {
    return this.http.get<string[]>(`/api/entities/${id}/owners`);
  }

  /** Add a co-Owner; returns the updated set. Idempotent (200), not a create. */
  addOwner(id: string, userId: string): Observable<string[]> {
    return this.http.post<string[]>(`/api/entities/${id}/owners`, { userId });
  }

  /** Remove an Owner or resign your own ownership; returns the updated set (ADR-0037). */
  removeOwner(id: string, userId: string): Observable<string[]> {
    return this.http.delete<string[]>(`/api/entities/${id}/owners/${userId}`);
  }

  // worldId scopes to a World (ADR-0024); omitted, server defaults to caller's first.
  create(
    name: string,
    type: EntityType,
    worldId?: string,
  ): Observable<EntityDetail> {
    return this.http.post<EntityDetail>('/api/entities', {
      name,
      type,
      ...(worldId ? { worldId } : {}),
    });
  }

  load(id: string): Observable<EntityDetail> {
    return this.http.get<EntityDetail>(`/api/entities/${id}`);
  }

  // Owner's Link Descriptor vocabulary — DISTINCT, last-saved state (#96, ADR-0023).
  listDescriptors(): Observable<string[]> {
    return this.http.get<string[]>('/api/entities/descriptors');
  }

  // Owner's Tag suggestion vocabulary — DISTINCT across their entities.
  listTags(): Observable<string[]> {
    return this.http.get<string[]>('/api/entities/tags');
  }

  /** Stale base → `conflict` outcome (ADR-0018), not a thrown error; caller branches, not catches. */
  save(
    id: string,
    body: EntityBody,
    version: number,
    tags: readonly string[],
  ): Observable<EntitySaveOutcome> {
    return this.http
      .put<EntityDetail>(`/api/entities/${id}`, {
        document: body,
        version,
        tags,
      })
      .pipe(
        map((saved): EntitySaveOutcome => ({ status: 'saved', entity: saved })),
        catchError((err: unknown) => {
          // A 409 means the base version moved: report the server's Entity as a
          // conflict. Guard that the body is actually an Entity — a non-JSON 409
          // (e.g. a proxy's HTML error page) falls through to the error path.
          if (
            err instanceof HttpErrorResponse &&
            err.status === 409 &&
            err.error !== null &&
            typeof err.error === 'object'
          ) {
            const current = err.error as EntityDetail;
            return of<EntitySaveOutcome>({ status: 'conflict', current });
          }
          return throwError(() => err);
        }),
      );
  }
}

/**
 * Serialize the shared query + Facet filters (#155) — the params both the paged
 * list and the Facet-count read carry. `type`/`tag`/`visibility` each repeat in the
 * query string (`?tag=a&tag=b`, OR within category); `q`/`worldId` are single-valued.
 */
function facetParams(opts: EntityFacetParams): HttpParams {
  let params = new HttpParams();
  if (opts.q) params = params.set('q', opts.q);
  for (const t of opts.type ?? []) params = params.append('type', t);
  for (const t of opts.tag ?? []) params = params.append('tag', t);
  for (const v of opts.visibility ?? []) params = params.append('visibility', v);
  if (opts.worldId) params = params.set('worldId', opts.worldId);
  return params;
}
