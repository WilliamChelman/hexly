import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ClientConfigStore } from '../services/client-config.store';

/**
 * Gates a route on the `server` Deployment Profile (ADR-0071): `/login` is no destination in the desktop
 * profile, where the Sole User has no password to satisfy it with (ADR-0070). Synchronous, unlike the auth
 * guards — {@link ClientConfigStore} settles in the app initializer and falls open until it does.
 */
export const serverProfileGuard: CanActivateFn = () => {
  const router = inject(Router);
  return inject(ClientConfigStore).isDesktopProfile() ? router.parseUrl('/') : true;
};

/** The mirror: a route that only means anything in the desktop profile (ADR-0071). */
export const desktopProfileGuard: CanActivateFn = () => {
  const router = inject(Router);
  return inject(ClientConfigStore).isDesktopProfile() ? true : router.parseUrl('/');
};
