import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { catchError, map, Observable, of, throwError } from 'rxjs';
import {
  EntityBody,
  EntityDetail,
  EntitySaveOutcome,
  EntitySummary,
  EntityType,
} from '@hexly/domain';

/**
 * The web client's HTTP conversation with the entities API (ADR-0018, ADR-0005).
 * Stateless: every verb is a round trip that returns what the server said. The
 * open-Entity/conflict state the editor reads lives in EntitySession, the seam
 * that actually consumes it — this stays one load/save/conflict surface for
 * every Entity type. The session cookie rides along via `withCredentials`.
 */
@Injectable({ providedIn: 'root' })
export class EntitiesClient {
  private readonly http = inject(HttpClient);

  list(): Observable<EntitySummary[]> {
    return this.http.get<EntitySummary[]>('/entities');
  }

  /**
   * Rename an Entity. Metadata only — it does not touch the body or its version,
   * so it never conflicts with an in-progress save.
   */
  rename(id: string, name: string): Observable<EntityDetail> {
    return this.http.patch<EntityDetail>(`/entities/${id}`, { name });
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`/entities/${id}`);
  }

  create(name: string, type: EntityType): Observable<EntityDetail> {
    return this.http.post<EntityDetail>('/entities', { name, type });
  }

  load(id: string): Observable<EntityDetail> {
    return this.http.get<EntityDetail>(`/entities/${id}`);
  }

  /**
   * Save `body` for an Entity, carrying the base `version` it was built on. A
   * stale base is reported as a `conflict` outcome carrying the server's current
   * Entity (ADR-0018), not as an error — that is an expected result of optimistic
   * concurrency, so the caller branches on it rather than catching it.
   */
  save(
    id: string,
    body: EntityBody,
    version: number,
    tags?: readonly string[],
  ): Observable<EntitySaveOutcome> {
    return this.http
      .put<EntityDetail>(`/entities/${id}`, { document: body, version, tags })
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
