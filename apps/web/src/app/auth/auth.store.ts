import { HttpClient } from '@angular/common/http';
import { computed, Injectable, inject, signal } from '@angular/core';
import { catchError, map, Observable, of, tap } from 'rxjs';
import { AuthUser } from '@hexly/domain';

/**
 * The web client's view of the session (ADR-0004, ADR-0005). The actual session
 * lives in an HttpOnly cookie the browser carries automatically; this store only
 * mirrors *who* that cookie authenticates, as a signal the UI and route guard
 * read. Requests are same-origin via the dev proxy, so the cookie rides along
 * without any client-side token handling.
 */
@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly http = inject(HttpClient);

  private readonly _currentUser = signal<AuthUser | null>(null);
  /** The authenticated user, or `null` when not logged in. */
  readonly currentUser = this._currentUser.asReadonly();
  /** Whether a user is currently authenticated. */
  readonly isAuthenticated = computed(() => this._currentUser() !== null);

  /** Exchange credentials for a session; mirrors the returned user locally. */
  login(email: string, password: string): Observable<AuthUser> {
    return this.http
      .post<AuthUser>('/auth/login', { email, password })
      .pipe(tap((user) => this._currentUser.set(user)));
  }

  /** End the session and forget the current user. */
  logout(): Observable<void> {
    return this.http
      .post<void>('/auth/logout', {})
      .pipe(tap(() => this._currentUser.set(null)));
  }

  /**
   * Ask the API who the cookie authenticates, syncing the local mirror. Emits
   * the user, or `null` if the session is absent/expired — never errors, so the
   * route guard can map the result straight to allow/redirect.
   */
  refresh(): Observable<AuthUser | null> {
    return this.http.get<AuthUser>('/auth/me').pipe(
      tap((user) => this._currentUser.set(user)),
      map((user): AuthUser | null => user),
      catchError(() => {
        this._currentUser.set(null);
        return of(null);
      }),
    );
  }
}
