import { computed, Injectable, Signal, inject } from '@angular/core';
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
 * `AuthUser` the app speaks via the `currentUser`/`isAuthenticated` signals the
 * route guards key off. The underlying client (and its session state) is owned
 * by `TrailbaseClient`, which any consumer can inject directly.
 *
 * There's no `sessionLoading`: the restored JWT settles the session synchronously
 * at construction (ADR-0032 — revocation is TTL-bounded, so we trust the
 * unexpired token rather than waiting on a server round-trip), so `currentUser`
 * is correct the moment a guard reads it. The background revalidation only
 * *downgrades* us to signed-out later if the refresh token was revoked.
 */
@Injectable({ providedIn: 'root' })
export class AuthClient {
  private readonly tb = inject(TrailbaseClient);
  private readonly router = inject(Router);

  readonly currentUser: Signal<AuthUser | null> = computed(() => toAuthUser(this.tb.user()));
  readonly isAuthenticated = computed(() => this.currentUser() !== null);

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
