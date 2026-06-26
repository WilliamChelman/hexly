import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, finalize, Observable, of, tap, throwError } from 'rxjs';
import { AuthUser } from '@hexly/domain';

/**
 * The web client's view of the session (ADR-0004, ADR-0005). The actual session
 * lives in an HttpOnly cookie the browser carries automatically; this store only
 * mirrors *who* that cookie authenticates, as a signal the UI and route guard
 * read. The cookie is sent with every request via the `withCredentials`
 * interceptor (so cross-origin/prod works too), with no client-side token handling.
 */
@Injectable({ providedIn: 'root' })
export class AuthClient {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly _currentUser = signal<AuthUser | null>(null);
  /** The authenticated user, or `null` when not logged in. */
  readonly currentUser = this._currentUser.asReadonly();
  /** Whether a user is currently authenticated. */
  readonly isAuthenticated = computed(() => this._currentUser() !== null);

  /** Exchange credentials for a session; mirrors the returned user locally. */
  login(email: string, password: string): Observable<AuthUser> {
    return this.http
      .post<AuthUser>('/api/auth/login', { email, password })
      .pipe(tap((user) => this._currentUser.set(user)));
  }

  /**
   * End the session and forget the current user. The local mirror is cleared
   * regardless of whether the server call succeeds — a failed logout must never
   * leave the UI stuck looking signed in — and the stream still completes so the
   * caller can navigate away.
   */
  logout(): Observable<void> {
    return this.http.post<void>('/api/auth/logout', {}).pipe(
      catchError(() => of(void 0)),
      finalize(() => this._currentUser.set(null)),
    );
  }

  /**
   * End the session and return to sign-in (ADR-0004); the local mirror is
   * cleared regardless of the server outcome, so the user is never stranded
   * looking signed in. Navigation fires in `finalize` so we always land on
   * /login. Owned here so the library and editor header don't each reimplement
   * the same logout→navigate dance.
   */
  signOut(): void {
    this.logout()
      .pipe(finalize(() => this.router.navigateByUrl('/login')))
      .subscribe();
  }

  /**
   * Ask the API who the cookie authenticates, syncing the local mirror. Emits
   * the user, or `null` when the server says the session is absent/expired
   * (401/403). Other failures (network, 5xx) are transient and are rethrown
   * without wiping the mirror, so the guard can tell "logged out" apart from
   * "the API hiccuped" instead of booting an authenticated user to /login.
   */
  refresh(): Observable<AuthUser | null> {
    return this.http.get<AuthUser>('/api/auth/me').pipe(
      tap((user) => this._currentUser.set(user)),
      catchError((err: unknown) => {
        if (
          err instanceof HttpErrorResponse &&
          (err.status === 401 || err.status === 403)
        ) {
          this._currentUser.set(null);
          return of(null);
        }
        return throwError(() => err);
      }),
    );
  }
}
