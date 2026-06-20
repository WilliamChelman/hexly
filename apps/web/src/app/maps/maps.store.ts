import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { catchError, map, Observable, of, tap, throwError } from 'rxjs';
import { HexMap, MapDetail, MapSummary } from '@hexly/domain';

/**
 * The result of a save. `saved` carries the stored map at its new version;
 * `conflict` means the base version had moved — `current` is the map as it now
 * stands on the server, so the editor can surface the clash and let the user
 * re-pull rather than lose the edit (issue #6, ADR-0002).
 */
export type SaveOutcome =
  | { status: 'saved'; map: MapDetail }
  | { status: 'conflict'; current: MapDetail };

/**
 * The web client's view of the user's Hex Maps (ADR-0002, ADR-0005). It owns the
 * HTTP conversation with the maps API and holds the currently open map as a
 * signal the editor reads. The session cookie rides along automatically via the
 * `withCredentials` interceptor, so there is no token handling here.
 */
@Injectable({ providedIn: 'root' })
export class MapsStore {
  private readonly http = inject(HttpClient);

  private readonly _current = signal<MapDetail | null>(null);
  /** The open map (with its document and base version), or `null` if none. */
  readonly current = this._current.asReadonly();

  private readonly _conflict = signal<MapDetail | null>(null);
  /**
   * The server's current map after a save was rejected as stale (409), or
   * `null` when there is no outstanding conflict. The editor reads this to
   * surface the clash and offer a re-pull (issue #6).
   */
  readonly conflict = this._conflict.asReadonly();

  /** The maps available to the user, as document-free metadata for a list view. */
  list(): Observable<MapSummary[]> {
    return this.http.get<MapSummary[]>('/maps');
  }

  /**
   * Rename a map. Metadata only — it does not touch the document or its version
   * (so it never conflicts with an in-progress save). If the renamed map is the
   * open one, the open map is updated to reflect the new title.
   */
  rename(id: string, title: string): Observable<MapDetail> {
    return this.http.patch<MapDetail>(`/maps/${id}`, { title }).pipe(
      tap((updated) => {
        if (this._current()?.id === updated.id) this._current.set(updated);
      }),
    );
  }

  /** Delete a map by id. The caller is responsible for any list/open cleanup. */
  delete(id: string): Observable<void> {
    return this.http.delete<void>(`/maps/${id}`);
  }

  /** Create a new, empty map by title and adopt it as the open map. */
  create(title: string): Observable<MapDetail> {
    return this.http
      .post<MapDetail>('/maps', { title })
      .pipe(tap((created) => this._current.set(created)));
  }

  /**
   * Load a map in full by id and adopt it as the open map. A fresh load also
   * clears any outstanding conflict — re-pulling is exactly how a stale-save
   * conflict is resolved (issue #6).
   */
  load(id: string): Observable<MapDetail> {
    return this.http.get<MapDetail>(`/maps/${id}`).pipe(
      tap((loaded) => {
        this._conflict.set(null);
        this._current.set(loaded);
      }),
    );
  }

  /**
   * Save `document` for the open map, carrying the base version it was built on.
   * On success the open map advances to the returned version, so the next save
   * is built on it.
   */
  save(document: HexMap): Observable<SaveOutcome> {
    const open = this.requireOpen();
    return this.http
      .put<MapDetail>(`/maps/${open.id}`, { document, version: open.version })
      .pipe(
        map((saved): SaveOutcome => {
          this._conflict.set(null);
          this._current.set(saved);
          return { status: 'saved', map: saved };
        }),
        catchError((err: unknown) => {
          // A 409 means the base version moved: surface the server's current map
          // as a conflict and leave the open map untouched, so the in-progress
          // edit is preserved for a re-pull rather than silently lost.
          if (err instanceof HttpErrorResponse && err.status === 409) {
            const current = err.error as MapDetail;
            this._conflict.set(current);
            return of<SaveOutcome>({ status: 'conflict', current });
          }
          return throwError(() => err);
        }),
      );
  }

  /** The open map, or a programming error if a save/edit is attempted with none. */
  private requireOpen(): MapDetail {
    const open = this._current();
    if (!open) throw new Error('No map is open');
    return open;
  }
}
