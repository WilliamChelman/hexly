import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { catchError, map, Observable, of, shareReplay, throwError } from 'rxjs';
import {
  EntityBody,
  EntityDetail,
  EntitySaveOutcome,
  EntitySummary,
  EntityType,
} from '@hexly/domain';

/**
 * HTTP client for the entities API (ADR-0018, ADR-0005).
 * Stateless: every call is a round trip; open-entity/conflict state lives in EntitySession.
 * Exception: `list()` is shared across subscribers for the session so the EntityLink picker
 * doesn't re-fetch on every mount/unmount cycle.
 */
@Injectable({ providedIn: 'root' })
export class EntitiesClient {
  private readonly http = inject(HttpClient);

  private readonly list$ = this.http.get<EntitySummary[]>('/api/entities').pipe(shareReplay(1));

  list(): Observable<EntitySummary[]> {
    return this.list$;
  }

  /** Metadata only — never conflicts with an in-progress save. */
  rename(id: string, name: string): Observable<EntityDetail> {
    return this.http.patch<EntityDetail>(`/api/entities/${id}`, { name });
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`/api/entities/${id}`);
  }

  create(name: string, type: EntityType): Observable<EntityDetail> {
    return this.http.post<EntityDetail>('/api/entities', { name, type });
  }

  load(id: string): Observable<EntityDetail> {
    return this.http.get<EntityDetail>(`/api/entities/${id}`);
  }

  /** Stale base → `conflict` outcome (ADR-0018), not a thrown error; caller branches, not catches. */
  save(
    id: string,
    body: EntityBody,
    version: number,
    tags: readonly string[],
  ): Observable<EntitySaveOutcome> {
    return this.http
      .put<EntityDetail>(`/api/entities/${id}`, { document: body, version, tags })
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
