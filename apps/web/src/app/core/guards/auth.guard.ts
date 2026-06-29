import { inject, Injector } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { filter, first, map } from 'rxjs';
import { toObservable } from '@angular/core/rxjs-interop';
import { AuthClient } from '../services/auth.client';

/**
 * Blocks a route until the session boot-check settles, then redirects to
 * `/login` if there is no authenticated user (ADR-0004). Guards wait for
 * `sessionLoading` rather than re-validating against the server on every
 * navigation — the rxResource auto-fetch runs once at boot and the result is
 * stable until an explicit login/logout.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthClient);
  const router = inject(Router);
  const injector = inject(Injector);
  const toLogin = () =>
    router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });

  return toObservable(auth.sessionLoading, { injector }).pipe(
    filter((loading) => !loading),
    first(),
    map(() => (auth.isAuthenticated() ? true : toLogin())),
  );
};

/**
 * The mirror image of {@link authGuard} for the `/login` route: an already
 * authenticated user has no business on the sign-in screen, so bounce them to
 * where they were headed (`returnUrl`) or the editor root.
 */
export const loginGuard: CanActivateFn = (route) => {
  const auth = inject(AuthClient);
  const router = inject(Router);
  const injector = inject(Injector);
  const home = () =>
    router.parseUrl(route.queryParamMap.get('returnUrl') ?? '/');

  return toObservable(auth.sessionLoading, { injector }).pipe(
    filter((loading) => !loading),
    first(),
    map(() => (auth.isAuthenticated() ? home() : true)),
  );
};
