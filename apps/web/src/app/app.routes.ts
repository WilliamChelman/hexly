import { Route } from '@angular/router';
import { authGuard, loginGuard } from './core/guards/auth.guard';
import { entityWorldRedirect } from './core/guards/entity-world-redirect.guard';
import { reconcileWorldSegment } from './core/guards/reconcile-world-segment.guard';
import {
  activeWorldResolver,
  clearActiveWorld,
} from './core/services/active-world';
import { flushOnLeave } from './pages/entity/flush-on-leave.guard';
import { EntitySession } from './pages/entity/services/entity-session';
import { EntityNameResolver } from './pages/entity/services/entity-name-resolver';
import { OutlineStore } from './pages/entity/services/outline-store';

export const appRoutes: Route[] = [
  {
    path: 'login',
    canActivate: [loginGuard],
    loadComponent: () => import('./pages/login/login').then((m) => m.Login),
    // Title key resolved by TranslationTitleStrategy to the "Hexly" brand (ADR-0014).
    title: 'auth.tabTitle',
  },
  {
    // The World Index (ADR-0028): the root lists every reachable World and owns
    // World create. It is the chooser — no auto-redirect into a World.
    path: '',
    pathMatch: 'full',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/world-index/world-index').then((m) => m.WorldIndex),
    title: 'worldIndex.tabTitle',
  },
  {
    // User Settings (ADR-0038): the account-owned Preferences + profile page.
    // Account-scoped, so it sits outside the World scope.
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/settings/settings').then((m) => m.Settings),
    title: 'settings.tabTitle',
  },
  {
    // The World scope (ADR-0028): a componentless parent that owns the `:worldId`
    // segment. Its resolver pins the active World before any child renders; its
    // canDeactivate clears it when navigation leaves the scope, so the Index never
    // shows a stale World. Children share the root outlet; the segment is navigation
    // context while an Entity's own world_id stays the data source of truth.
    path: 'w/:worldId',
    canActivate: [authGuard],
    canDeactivate: [clearActiveWorld],
    resolve: { activeWorld: activeWorldResolver },
    children: [
      {
        // The World settings page (#158): the World-level owner set — view, add,
        // remove, resign. Bare by design; more World settings can join it later.
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('./pages/world-settings/world-settings').then(
            (m) => m.WorldSettings,
          ),
        title: 'owners.tabTitle',
      },
      {
        // The Entity browser: every Entity in this World — notes and maps — plus
        // open / create / rename / delete (#70).
        path: 'entities',
        pathMatch: 'full',
        loadComponent: () =>
          import('./pages/entity-browser/entity-browser').then(
            (m) => m.EntityBrowser,
          ),
        // Title key resolved by TranslationTitleStrategy to the "Hexly" brand (ADR-0014).
        title: 'entityBrowser.tabTitle',
      },
      {
        // The open-Entity route (#70). The id reopens the same Entity on reload (#6);
        // the routed page renders its own header (ADR-0022).
        path: 'entities/:id',
        // Reconcile a stale/hand-edited World segment against the Entity's real
        // world_id before the page renders (ADR-0028, #119): the highest-point
        // guard, redirecting to the Entity under its correct World on mismatch.
        canActivate: [reconcileWorldSegment],
        // Await a pending autosave before leaving the route, so an in-app navigation
        // never drops a debounced edit (ADR-0026).
        canDeactivate: [flushOnLeave],
        // One EntitySession for the subtree, destroyed on leave, so open-Entity state
        // resets implicitly (#70). EntityNameResolver batches id→name lookups for the
        // entityLink node views (the `@` picker searches the server directly); route-scoped
        // so navigating to another Entity re-resolves names against a fresh cache (ADR-0023).
        providers: [EntitySession, EntityNameResolver, OutlineStore],
        // Tab title is the open Entity's name composed with the brand ("Aldermoor —
        // Hexly") via documentTitleKey; `title` is the pre-load fallback (ADR-0014).
        title: 'editorShell.tabTitle',
        data: { documentTitleKey: 'editorShell.tabTitleNamed' },
        loadComponent: () =>
          import('./pages/entity/entity.page').then((m) => m.EntityPage),
      },
    ],
  },
  {
    // World-agnostic Entity link target (issue #118 follow-up). A Content Link
    // doesn't know its target's World — links can cross Worlds — so this abstract
    // route resolves the World by id and redirects to the canonical
    // `/w/:worldId/entities/:id`. authGuard runs first so an unauthenticated hit
    // goes to login; a missing/inaccessible target renders the error page.
    path: 'entities/:id',
    canActivate: [authGuard, entityWorldRedirect],
    loadComponent: () =>
      import('./pages/error/error-page').then((m) => m.ErrorPage),
    title: 'error.tabTitle',
  },
  {
    path: 'styleguide',
    loadComponent: () =>
      import('./pages/styleguide/styleguide').then((m) => m.Styleguide),
    // Title key resolved by TranslationTitleStrategy to the "Hexly" brand (ADR-0014).
    title: 'styleguide.tabTitle',
  },
  // The unauthenticated Public Link surface (ADR-0037, #162): token-scoped, read-only pages a
  // person without an account reaches by URL. Deliberately outside authGuard — possession of the
  // token is the credential. A per-entity link, a World link, and a World-scoped page open.
  {
    path: 'public/e/:token',
    data: { mode: 'entity' },
    loadComponent: () =>
      import('./pages/public/public-entity-page').then((m) => m.PublicEntityPage),
    title: 'publicView.tabTitle',
  },
  {
    path: 'public/w/:token',
    loadComponent: () =>
      import('./pages/public/public-world-page').then((m) => m.PublicWorldPage),
    title: 'publicView.tabTitle',
  },
  {
    // `:entityId` (not `:id`) keeps the reused EntityPage's watchRoute from matching, but the
    // real guard is PublicEntityPage marking the session externally driven — it is the sole
    // data source (#162), adopting the Entity from the token-scoped public surface.
    path: 'public/w/:token/e/:entityId',
    data: { mode: 'worldEntity' },
    loadComponent: () =>
      import('./pages/public/public-entity-page').then((m) => m.PublicEntityPage),
    title: 'publicView.tabTitle',
  },
  // Anything unmatched renders the error page rather than silently bouncing to
  // the World Index, so a wrong URL is visible, not papered over. authGuard keeps
  // an unauthenticated visitor going to login first.
  {
    path: '**',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/error/error-page').then((m) => m.ErrorPage),
    title: 'error.tabTitle',
  },
];
