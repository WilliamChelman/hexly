import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ClientConfigStore } from '../services/client-config.store';

/**
 * Gates a route on the Collaboration layer (ADR-0071): with it off, user management is no destination.
 * Synchronous, unlike the auth guards — {@link ClientConfigStore} settles in the
 * app initializer and falls open until it does.
 */
export const collaborationGuard: CanActivateFn = () => {
  const router = inject(Router);
  return inject(ClientConfigStore).isCollaborationEnabled() ? true : router.parseUrl('/');
};
