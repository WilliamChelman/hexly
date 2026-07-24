import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, Injectable, Injector, inject, Signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { catchError, finalize, Observable, of, tap, throwError } from 'rxjs';
import { AuthUser, canManageUsers as canManageUsersRule, canCreateWorlds as canCreateWorldsRule } from '@hexly/domain';

/**
 * The web client's view of the session. The actual session lives in an HttpOnly
 * cookie; this service mirrors who it authenticates as signals. The cookie is
 * sent automatically via the `withCredentials` interceptor.
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
          if (err instanceof HttpErrorResponse && (err.status === 401 || err.status === 403)) {
            return of(null);
          }
          return throwError(() => err);
        }),
      ),
  });

  readonly currentUser: Signal<AuthUser | null> = this.session.value.asReadonly();
  readonly isAuthenticated = computed(() => this.currentUser() !== null);
  readonly sessionLoading = this.session.isLoading;

  /**
   * Whether the caller may reach the user-management (`/users`) surface: holds the
   * `manage-users` Instance Role, or is a Superadmin (who supersedes every role).
   */
  readonly canManageUsers = computed(() => {
    const u = this.currentUser();
    return !!u && canManageUsersRule(u);
  });

  /** Whether the caller is a Superadmin — gates the Superadmin-only controls. */
  readonly isSuperadmin = computed(() => this.currentUser()?.isSuperadmin ?? false);

  /** Whether the caller may create Worlds. A Superadmin always may, regardless of the roles set. */
  readonly canCreateWorlds = computed(() => {
    const u = this.currentUser();
    return !!u && canCreateWorldsRule(u);
  });

  login(email: string, password: string): Observable<AuthUser> {
    return this.http.post<AuthUser>('/api/auth/login', { email, password }).pipe(tap((user) => this.session.set(user)));
  }

  /** Rename the account; the fresh AuthUser replaces the session state. */
  updateProfile(displayName: string): Observable<AuthUser> {
    return this.http
      .patch<AuthUser>('/api/auth/me/profile', { displayName })
      .pipe(tap((user) => this.session.set(user)));
  }

  /** Change the password. Errors (wrong current, too short) pass through. */
  changePassword(currentPassword: string, newPassword: string): Observable<void> {
    return this.http.post<void>('/api/auth/me/password', {
      currentPassword,
      newPassword,
    });
  }

  // Clear in finalize so failed logout never leaves UI signed-in.
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
