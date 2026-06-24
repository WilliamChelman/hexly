import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { catchError, map, Observable, of, tap, throwError } from 'rxjs';
import {
  EntityBody,
  EntityDetail,
  EntitySaveOutcome,
  EntitySummary,
  EntityType,
} from '@hexly/domain';

/**
 * The web client's view of the user's Entities (ADR-0018, ADR-0005). It owns the
 * HTTP conversation with the entities API and holds the currently open Entity as
 * a signal the editor seam reads. The session cookie rides along automatically
 * via the `withCredentials` interceptor, so there is no token handling here.
 *
 * This store is Entity-generic: it carries the opaque body (Content plus any
 * typed payload) end to end. The hexmap-specific adaptation between a body and
 * the hex-grid the canvas edits lives in the editor seam (EditorSession), not
 * here, so the store stays a single load/save/version-conflict surface for every
 * Entity type.
 */
@Injectable({ providedIn: 'root' })
export class EntitiesStore {
  private readonly http = inject(HttpClient);

  private readonly _current = signal<EntityDetail | null>(null);
  /** The open Entity (with its body and base version), or `null` if none. */
  readonly current = this._current.asReadonly();

  private readonly _conflict = signal<EntityDetail | null>(null);
  /**
   * The server's current Entity after a save was rejected as stale (409), or
   * `null` when there is no outstanding conflict. The editor reads this to
   * surface the clash and offer a re-pull (ADR-0018).
   */
  readonly conflict = this._conflict.asReadonly();

  /** The Entities available to the user, as body-free metadata for a list view. */
  list(): Observable<EntitySummary[]> {
    return this.http.get<EntitySummary[]>('/entities');
  }

  /**
   * Rename an Entity. Metadata only — it does not touch the body or its version
   * (so it never conflicts with an in-progress save). If the renamed Entity is
   * the open one, the open Entity is updated to reflect the new name.
   */
  rename(id: string, name: string): Observable<EntityDetail> {
    return this.http.patch<EntityDetail>(`/entities/${id}`, { name }).pipe(
      tap((updated) => {
        if (this._current()?.id === updated.id) {
          this._current.set(updated);
          // A successful metadata change on the open Entity clears any stale 409
          // chip from an earlier save — it no longer reflects the current state.
          this._conflict.set(null);
        }
      }),
    );
  }

  /**
   * Delete an Entity by id. The caller is responsible for any list cleanup; if
   * the deleted Entity was the open one, its open/conflict state is cleared so
   * nothing dangling points at an Entity that no longer exists.
   */
  delete(id: string): Observable<void> {
    return this.http.delete<void>(`/entities/${id}`).pipe(
      tap(() => {
        if (this._current()?.id === id) {
          this._current.set(null);
          this._conflict.set(null);
        }
      }),
    );
  }

  /** Create a new, empty Entity of `type` by name and adopt it as the open one. */
  create(name: string, type: EntityType): Observable<EntityDetail> {
    return this.http.post<EntityDetail>('/entities', { name, type }).pipe(
      tap((created) => {
        this._current.set(created);
        this._conflict.set(null);
      }),
    );
  }

  /**
   * Load an Entity in full by id and adopt it as the open one. A fresh load also
   * clears any outstanding conflict — re-pulling is exactly how a stale-save
   * conflict is resolved (ADR-0018).
   */
  load(id: string): Observable<EntityDetail> {
    return this.http.get<EntityDetail>(`/entities/${id}`).pipe(
      tap((loaded) => {
        this._conflict.set(null);
        this._current.set(loaded);
      }),
    );
  }

  /**
   * Save `body` for the open Entity, carrying the base version it was built on.
   * On success the open Entity advances to the returned version, so the next
   * save is built on it.
   */
  save(body: EntityBody): Observable<EntitySaveOutcome> {
    const open = this.requireOpen();
    return this.http
      .put<EntityDetail>(`/entities/${open.id}`, {
        document: body,
        version: open.version,
      })
      .pipe(
        map((saved): EntitySaveOutcome => {
          this._conflict.set(null);
          this._current.set(saved);
          return { status: 'saved', entity: saved };
        }),
        catchError((err: unknown) => {
          // A 409 means the base version moved: surface the server's current
          // Entity as a conflict and leave the open Entity untouched, so the
          // in-progress edit is preserved for a re-pull rather than silently lost.
          if (err instanceof HttpErrorResponse && err.status === 409) {
            const current = err.error as EntityDetail;
            this._conflict.set(current);
            return of<EntitySaveOutcome>({ status: 'conflict', current });
          }
          return throwError(() => err);
        }),
      );
  }

  /** The open Entity, or a programming error if a save/edit is attempted with none. */
  private requireOpen(): EntityDetail {
    const open = this._current();
    if (!open) throw new Error('No entity is open');
    return open;
  }
}
