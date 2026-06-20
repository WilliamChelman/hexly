import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs';
import { AuthStore } from './auth.store';

/**
 * Blocks a route until a session is established, redirecting to `/login`
 * otherwise (ADR-0004 — there is no anonymous access to the editor). If the
 * session is already known it resolves synchronously; otherwise it asks the API
 * once (`/auth/me`) and maps the answer to allow-or-redirect.
 */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthStore);
  const router = inject(Router);

  if (auth.isAuthenticated()) return true;

  return auth
    .refresh()
    .pipe(map((user) => (user ? true : router.createUrlTree(['/login']))));
};
