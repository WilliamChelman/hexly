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
  EntityListQuery,
  EntityPage,
  EntitySaveOutcome,
  EntityType,
} from '@hexly/domain';

export type EntityListParams = Partial<EntityListQuery>;

/**
 * HTTP client for the entities API (ADR-0018, ADR-0005).
 * Stateless: every call is a round trip; open-entity/conflict state lives in EntitySession.
 */
@Injectable({ providedIn: 'root' })
export class EntitiesClient {
  private readonly http = inject(HttpClient);

  /** One page of the entities read surface (ADR-0025); `opts` filter and page it. */
  list(opts: EntityListParams = {}): Observable<EntityPage> {
    let params = new HttpParams();
    // `ids` repeats the param once per id; the others are single-valued.
    for (const id of opts.ids ?? []) params = params.append('ids', id);
    if (opts.q) params = params.set('q', opts.q);
    if (opts.type) params = params.set('type', opts.type);
    if (opts.worldId) params = params.set('worldId', opts.worldId);
    if (opts.cursor) params = params.set('cursor', opts.cursor);
    if (opts.limit !== undefined) params = params.set('limit', opts.limit);
    return this.http.get<EntityPage>('/api/entities', { params });
  }

  /** Metadata only — never conflicts with an in-progress save. */
  rename(id: string, name: string): Observable<EntityDetail> {
    return this.http.patch<EntityDetail>(`/api/entities/${id}`, { name });
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`/api/entities/${id}`);
  }

  /** `worldId` scopes the new Entity to a World (ADR-0024); omitted, the server defaults to the caller's first World. */
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

  /** The owner's `::` Link Descriptor vocabulary — DISTINCT, last-saved state (#96, ADR-0023). */
  listDescriptors(): Observable<string[]> {
    return this.http.get<string[]>('/api/entities/descriptors');
  }

  /** Stale base → `conflict` outcome (ADR-0018), not a thrown error; caller branches, not catches. */
  save(
    id: string,
    body: EntityBody,
    version: number,
    tags: readonly string[],
    descriptors: readonly string[],
  ): Observable<EntitySaveOutcome> {
    return this.http
      .put<EntityDetail>(`/api/entities/${id}`, {
        document: body,
        version,
        tags,
        descriptors,
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
