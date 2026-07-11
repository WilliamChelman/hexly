import { Route } from '@angular/router';
import { manageUsersGuard, superadminGuard, authGuard, loginGuard, entityWorldRedirect, reconcileWorldSegment, activeWorldGuard, clearActiveWorld } from '@hexly/web-core';

// `title` values are transloco keys, resolved by TranslationTitleStrategy.
export const appRoutes: Route[] = [
  {
    path: 'login',
    canActivate: [loginGuard],
    loadComponent: () => import('./pages/login/login').then((m) => m.Login),
    title: 'auth.tabTitle',
  },
  {
    // The World Index: the chooser — no auto-redirect into a World.
    path: '',
    pathMatch: 'full',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/world-index/world-index').then((m) => m.WorldIndex),
    title: 'worldIndex.tabTitle',
  },
  {
    // Account-scoped, so it sits outside the World scope.
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/user-settings/user-settings').then((m) => m.UserSettings),
    title: 'settings.tabTitle',
  },
  {
    // User management (ADR-0047). Account-scoped like Settings; the server
    // re-checks every action.
    path: 'users',
    canActivate: [manageUsersGuard],
    loadComponent: () => import('./pages/users/users').then((m) => m.Users),
    title: 'users.tabTitle',
  },
  {
    // The Superadmin repair surface: the Reindex (ADR-0046). Superadmin-only.
    path: 'admin',
    canActivate: [superadminGuard],
    loadComponent: () => import('./pages/admin/admin').then((m) => m.Admin),
    title: 'admin.tabTitle',
  },
  {
    // World scope: activeWorldGuard fetches and pins the active World (and
    // self-heals the slug) before any child renders; clearActiveWorld unpins on
    // leaving the scope so the Index never shows a stale World.
    path: 'w/:worldId',
    canActivate: [authGuard, activeWorldGuard],
    canDeactivate: [clearActiveWorld],
    loadComponent: () =>
      import('./pages/world/world-layout').then((m) => m.WorldLayout),
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('./pages/world/world-dashboard').then((m) => m.WorldDashboard),
        title: 'worldDashboard.tabTitle',
      },
      {
        // World-level owner management; Owner-only.
        path: 'settings',
        pathMatch: 'full',
        loadComponent: () =>
          import('./pages/world/pages/world-settings/world-settings').then(
            (m) => m.WorldSettings,
          ),
        title: 'owners.tabTitle',
      },
      {
        path: 'entities',
        pathMatch: 'full',
        loadComponent: () =>
          import('./pages/entity-browser/entity-browser').then(
            (m) => m.EntityBrowser,
          ),
        title: 'entityBrowser.tabTitle',
      },
      {
        // The World Graph (#181). Lazy on its own chunk: cosmos.gl is ~168 kB gzip
        // of WebGL that nothing outside this page needs.
        path: 'graph',
        pathMatch: 'full',
        loadComponent: () =>
          import('./pages/world/world-graph/world-graph').then((m) => m.WorldGraph),
        title: 'worldGraph.tabTitle',
      },
      {
        path: 'entities/:id',
        // Reconcile a stale/hand-edited World segment against the Entity's real
        // world_id, redirecting to the correct World on mismatch. Stays here (not
        // in the lazy child) so its parent is still `w/:worldId` — where the guard
        // reads the worldId segment from.
        canActivate: [reconcileWorldSegment],
        // The editor's providers + component live in a lazy child config so the
        // ContentEditor barrel (TipTap) never lands in the initial bundle.
        loadChildren: () =>
          import('./pages/entity/entity.routes').then((m) => m.ENTITY_ROUTES),
      },
    ],
  },
  {
    // World-agnostic Entity link target: a Content Link can cross Worlds, so this
    // route resolves the target's World by id and redirects to the canonical
    // `/w/:worldId/entities/:id`; a missing/inaccessible target renders the error page.
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
    title: 'styleguide.tabTitle',
  },
  // Unauthenticated Public Link surface: token-scoped, read-only. Deliberately
  // outside authGuard — possession of the token is the credential.
  {
    path: 'public/e/:token',
    data: { mode: 'entity' },
    loadComponent: () =>
      import('./pages/public/public-entity-page').then(
        (m) => m.PublicEntityPage,
      ),
    title: 'publicView.tabTitle',
  },
  {
    path: 'public/w/:token',
    loadComponent: () =>
      import('./pages/public/public-world-page').then((m) => m.PublicWorldPage),
    title: 'publicView.tabTitle',
  },
  {
    // `:entityId` (not `:id`) keeps the reused EntityPage's watchRoute from matching;
    // PublicEntityPage marks the session externally driven and is the sole data source.
    path: 'public/w/:token/e/:entityId',
    data: { mode: 'worldEntity' },
    loadComponent: () =>
      import('./pages/public/public-entity-page').then(
        (m) => m.PublicEntityPage,
      ),
    title: 'publicView.tabTitle',
  },
  // Unmatched URLs render the error page rather than bouncing to the Index, so a
  // wrong URL is visible, not papered over.
  {
    path: '**',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/error/error-page').then((m) => m.ErrorPage),
    title: 'error.tabTitle',
  },
];
