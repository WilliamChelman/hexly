import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  computed, Injectable, Injector, inject, Signal,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { catchError, finalize, Observable, of, tap, throwError } from 'rxjs';
import { AuthUser } from '@hexly/domain';

/**
 * The web client's view of the session (ADR-0004, ADR-0005). The actual session
 * lives in an HttpOnly cookie; this service mirrors who it authenticates as
 * signals. The cookie is sent automatically via the `withCredentials` interceptor.
 */
@Injectable({ providedIn: 'root' })
export class AuthClient {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);

  private readonly session = rxResource<AuthUser | null, undefined>({
    injector: this.injector,
    defaultValue: null,
    stream: () =>
      this.http.get<AuthUser>('/api/auth/me').pipe(
        catchError((err: unknown) => {
          if (
            err instanceof HttpErrorResponse &&
            (err.status === 401 || err.status === 403)
          ) {
            return of(null);
          }
          return throwError(() => err);
        }),
      ),
  });

  readonly currentUser: Signal<AuthUser | null> = this.session.value.asReadonly();
  readonly isAuthenticated = computed(() => this.currentUser() !== null);
  // true from construction until the boot /auth/me resolves; guards wait on this.
  readonly sessionLoading = this.session.isLoading;

  login(email: string, password: string): Observable<AuthUser> {
    return this.http
      .post<AuthUser>('/api/auth/login', { email, password })
      .pipe(tap((user) => this.session.set(user)));
  }

  // Mirror is cleared in finalize so a failed logout never leaves the UI stuck signed-in.
  logout(): Observable<void> {
    return this.http.post<void>('/api/auth/logout', {}).pipe(
      catchError(() => of(void 0)),
      finalize(() => this.session.set(null)),
    );
  }

  signOut(): void {
    this.logout()
      .pipe(finalize(() => this.router.navigateByUrl('/login')))
      .subscribe();
  }
}
