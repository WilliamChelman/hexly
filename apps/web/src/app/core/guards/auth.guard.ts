import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthClient } from '../services/auth.client';

/**
 * Blocks a route until a session is established, redirecting to `/login`
 * otherwise (ADR-0004 — there is no anonymous access to the editor).
 *
 * It always re-validates against the server (`/auth/me`) on activation rather
 * than trusting the in-memory signal, so a server-side revocation is noticed on
 * the next in-app navigation instead of lingering until reload. `refresh()` is a
 * cheap GET and only redirects on a definite 401/403; a transient failure
 * (network, 5xx) rethrows, and we let the user through with whatever session we
 * already know — better than booting an authenticated user to /login on a hiccup.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthClient);
  const router = inject(Router);

  const toLogin = () =>
    router.createUrlTree(['/login'], {
      queryParams: { returnUrl: state.url },
    });

  return auth.refresh().pipe(
    map((user) => (user ? true : toLogin())),
    catchError(() => of(auth.isAuthenticated() ? true : toLogin())),
  );
};

/**
 * The mirror image of {@link authGuard} for the `/login` route: an already
 * authenticated user has no business on the sign-in screen, so bounce them to
 * where they were headed (`returnUrl`) or the editor. It re-validates against
 * the server the same way — `refresh()` only reports "logged out" on a definite
 * 401/403; a transient failure falls back to whatever session we already know.
 */
export const loginGuard: CanActivateFn = (route) => {
  const auth = inject(AuthClient);
  const router = inject(Router);

  const home = () =>
    router.parseUrl(route.queryParamMap.get('returnUrl') ?? '/');

  return auth.refresh().pipe(
    map((user) => (user ? home() : true)),
    catchError(() => (auth.isAuthenticated() ? of(home()) : of(true))),
  );
};
