import { computed, Injectable, Signal, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, finalize, from, map, Observable, of } from 'rxjs';
import type { User } from 'trailbase';
import { AuthUser } from '@hexly/domain';
import { TrailbaseClient } from './trailbase-client';

/**
 * TrailBase's `User` carries no display name, so derive one from the email's
 * local part (the closed set logs in with email). Falls back to the id only if
 * an account somehow has neither — never blank, which the avatar relies on.
 */
function toAuthUser(user: User | undefined): AuthUser | null {
  if (!user) return null;
  const email = user.email ?? user.username ?? '';
  return { id: user.id, email, displayName: email.split('@')[0] || email || user.id };
}

/**
 * The web client's view of the session (ADR-0004, ADR-0032) — a thin domain
 * facade over {@link TrailbaseClient}. It maps the transport's `User` to the
 * `AuthUser` the app speaks and keeps the signal surface
 * (`currentUser`/`isAuthenticated`/`sessionLoading`) the route guards key off,
 * unchanged from the cookie-session era. The underlying client (and its session
 * state) is owned by `TrailbaseClient`, which any consumer can inject directly.
 */
@Injectable({ providedIn: 'root' })
export class AuthClient {
  private readonly tb = inject(TrailbaseClient);
  private readonly router = inject(Router);

  // true until the constructor settles the restored session; guards wait on this.
  private readonly _loading = signal(true);

  readonly currentUser: Signal<AuthUser | null> = computed(() => toAuthUser(this.tb.user()));
  readonly isAuthenticated = computed(() => this.currentUser() !== null);
  readonly sessionLoading = this._loading.asReadonly();

  constructor() {
    // Trust the restored, unexpired JWT (ADR-0032 — revocation is TTL-bounded):
    // the session is settled the moment we read it. The background revalidation
    // only *downgrades* us to signed-out if the refresh token was revoked. So
    // there's no server round-trip to wait on, which is what the guards key off.
    this._loading.set(false);
  }

  login(email: string, password: string): Observable<AuthUser> {
    // The session signal updates via the client's onAuthChange; we just surface
    // the established AuthUser (and reject a login that didn't establish one).
    return from(this.tb.client.login(email, password)).pipe(
      map(() => {
        const user = toAuthUser(this.tb.client.user());
        if (!user) throw new Error('Login did not establish a session.');
        return user;
      }),
    );
  }

  // The client revokes locally even if the network logout fails (firing
  // onAuthChange → signed out), so swallowing the transport error is safe.
  logout(): Observable<void> {
    return from(this.tb.client.logout()).pipe(
      map(() => undefined),
      catchError(() => of(undefined)),
    );
  }

  signOut(): void {
    this.logout()
      .pipe(finalize(() => this.router.navigateByUrl('/login')))
      .subscribe();
  }
}
