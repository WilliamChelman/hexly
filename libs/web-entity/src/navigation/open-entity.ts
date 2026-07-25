import { Router } from '@angular/router';

/**
 * Follow a route the way a link would: in place, or in a new tab when a Ctrl/Cmd (or middle) click
 * asked for one. Both graph surfaces (ADR-0072) emit that modifier off a canvas rather than an `<a>`,
 * so the new-tab half — which the browser gives a real link for free — is spelled out once here.
 */
export function openEntityRoute(router: Router, route: unknown[], newTab: boolean): void {
  if (newTab) {
    window.open(router.serializeUrl(router.createUrlTree(route)), '_blank', 'noopener');
    return;
  }
  void router.navigate(route);
}
