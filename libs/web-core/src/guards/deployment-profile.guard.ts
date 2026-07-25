import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ClientConfigStore } from '../services/client-config.store';

/**
 * Gates a route on the `server` Deployment Profile (ADR-0071): `/login` is no destination in the
 * desktop profile, where the Sole User has no password to satisfy it with (ADR-0070), so it bounces
 * to the root. A policy question — "is this a meaningful destination here?" — so it reads the flag.
 *
 * Composed alongside the login guard rather than folded into it, for the reason the Collaboration
 * guard is: a session check is no proxy for a deployment fact.
 *
 * Synchronous, unlike the auth guards: {@link ClientConfigStore} settles in the app initializer and
 * falls open until it does, so there is nothing to wait for.
 */
export const serverProfileGuard: CanActivateFn = () => {
  const router = inject(Router);
  return inject(ClientConfigStore).isDesktopProfile() ? router.parseUrl('/') : true;
};

/**
 * The mirror: a route that only means anything in the desktop profile. The unrecoverable-session
 * page tells the reader there is no sign-in to fall back on, which is false on a server (ADR-0071).
 */
export const desktopProfileGuard: CanActivateFn = () => {
  const router = inject(Router);
  return inject(ClientConfigStore).isDesktopProfile() ? true : router.parseUrl('/');
};
