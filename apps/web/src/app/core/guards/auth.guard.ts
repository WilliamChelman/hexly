import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthClient } from '../services/auth.client';

/**
 * Redirects to `/login` (preserving the intended destination) when there is no
 * authenticated user (ADR-0004). The check is synchronous: `AuthClient` settles
 * the session from the stored JWT at construction (ADR-0032), so `currentUser`
 * is already correct here — no server round-trip per navigation.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthClient);
  const router = inject(Router);

  return auth.isAuthenticated()
    ? true
    : router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

/**
 * The mirror image of {@link authGuard} for the `/login` route: an already
 * authenticated user has no business on the sign-in screen, so bounce them to
 * where they were headed (`returnUrl`) or the editor root.
 */
export const loginGuard: CanActivateFn = (route) => {
  const auth = inject(AuthClient);
  const router = inject(Router);

  return auth.isAuthenticated()
    ? router.parseUrl(route.queryParamMap.get('returnUrl') ?? '/')
    : true;
};
