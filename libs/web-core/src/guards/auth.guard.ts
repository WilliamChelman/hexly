import { inject, Injector } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { filter, first, map } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';
import { AuthClient } from '../services/auth.client';
import { ClientConfigStore } from '../services/client-config.store';

/**
 * Where a navigation without a session goes: the desktop profile has no password a login form could ask for
 * (ADR-0070, ADR-0071). Dependencies are arguments because the guards call this from an rxjs operator,
 * outside their injection context.
 */
function unauthenticatedDestination(router: Router, config: ClientConfigStore, url: string): UrlTree {
  return config.isDesktopProfile()
    ? router.parseUrl('/session-error')
    : router.createUrlTree(['/login'], { queryParams: { returnUrl: url } });
}

/**
 * Blocks a route until the session boot-check settles, then redirects to
 * `/login` if there is no authenticated user (ADR-0004) — or, in the desktop profile, to the
 * unrecoverable-session error. No per-navigation re-validation: the session resource fetches once at
 * boot and stays valid until an explicit login/logout.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthClient);
  const router = inject(Router);
  const config = inject(ClientConfigStore);
  const injector = inject(Injector);
  const noSession = () => unauthenticatedDestination(router, config, state.url);

  return toObservable(auth.sessionLoading, { injector }).pipe(
    filter((loading) => !loading),
    first(),
    map(() => (auth.isAuthenticated() ? true : noSession())),
  );
};

/**
 * Like {@link authGuard}, but also requires the `manage-users` role or Superadmin
 * for the `/users` surface (ADR-0047); a signed-in user without it goes to the root.
 * Not a security boundary — the server 403s regardless; this only hides an unusable page.
 */
export const manageUsersGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthClient);
  const router = inject(Router);
  const config = inject(ClientConfigStore);
  const injector = inject(Injector);
  const noSession = () => unauthenticatedDestination(router, config, state.url);

  return toObservable(auth.sessionLoading, { injector }).pipe(
    filter((loading) => !loading),
    first(),
    map(() => {
      if (!auth.isAuthenticated()) return noSession();
      return auth.canManageUsers() ? true : router.parseUrl('/');
    }),
  );
};

/**
 * Like {@link manageUsersGuard}, but gates the `/admin` repair surface (ADR-0046,
 * the Reindex) on the Superadmin flag alone.
 */
export const superadminGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthClient);
  const router = inject(Router);
  const config = inject(ClientConfigStore);
  const injector = inject(Injector);
  const noSession = () => unauthenticatedDestination(router, config, state.url);

  return toObservable(auth.sessionLoading, { injector }).pipe(
    filter((loading) => !loading),
    first(),
    map(() => {
      if (!auth.isAuthenticated()) return noSession();
      return auth.isSuperadmin() ? true : router.parseUrl('/');
    }),
  );
};

/**
 * The mirror image of {@link authGuard} for `/login`: an already authenticated user
 * is sent to `returnUrl`, or the editor root when there is none.
 */
export const loginGuard: CanActivateFn = (route) => {
  const auth = inject(AuthClient);
  const router = inject(Router);
  const injector = inject(Injector);
  const home = () => router.parseUrl(route.queryParamMap.get('returnUrl') ?? '/');

  return toObservable(auth.sessionLoading, { injector }).pipe(
    filter((loading) => !loading),
    first(),
    map(() => (auth.isAuthenticated() ? home() : true)),
  );
};
