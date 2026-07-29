import { Route } from '@angular/router';
import {
  collaborationGuard,
  manageUsersGuard,
  superadminGuard,
  authGuard,
  loginGuard,
  serverProfileGuard,
  desktopProfileGuard,
  entityWorldRedirect,
  reconcileWorldSegment,
  activeWorldGuard,
  clearActiveWorld,
} from '@hexly/web-core';

// `title` values are transloco keys, resolved by TranslationTitleStrategy.
export const appRoutes: Route[] = [
  {
    // No password exists in the desktop profile, so the profile guard bounces this page (ADR-0071).
    path: 'login',
    canActivate: [serverProfileGuard, loginGuard],
    loadComponent: () => import('./pages/login/login.page').then((m) => m.LoginPage),
    title: 'auth.tabTitle',
  },
  {
    // Where the desktop profile's unrecoverable session lands, since /login cannot help it (ADR-0070).
    // Desktop-only: a server has a sign-in to fall back on (ADR-0071).
    path: 'session-error',
    canActivate: [desktopProfileGuard],
    loadComponent: () => import('./pages/session-error/session-error.page').then((m) => m.SessionErrorPage),
    title: 'auth.sessionError.tabTitle',
  },
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'worlds',
  },
  {
    // The World Index: the chooser — no auto-redirect into a World.
    path: 'worlds',
    pathMatch: 'full',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/worlds/worlds.page').then((m) => m.WorldsPage),
    title: 'worldIndex.tabTitle',
  },
  {
    // Account-scoped, so it sits outside the World scope.
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/user-settings/user-settings.page').then((m) => m.UserSettingsPage),
    title: 'settings.tabTitle',
  },
  {
    // User management (ADR-0047). Account-scoped like Settings; the server
    // re-checks every action. Collaboration off cuts it entirely (ADR-0071).
    path: 'users',
    canActivate: [collaborationGuard, manageUsersGuard],
    loadComponent: () => import('./pages/users/users.page').then((m) => m.UsersPage),
    title: 'users.tabTitle',
  },
  {
    // The Superadmin repair surface: the Reindex (ADR-0046). Superadmin-only.
    path: 'admin',
    canActivate: [superadminGuard],
    loadComponent: () => import('@hexly/admin-web').then((m) => m.AdminPage),
    title: 'admin.tabTitle',
  },
  {
    // World scope: activeWorldGuard fetches and pins the active World (and
    // self-heals the slug) before any child renders; clearActiveWorld unpins on
    // leaving the scope so the Index never shows a stale World.
    path: 'w/:worldId',
    canActivate: [authGuard, activeWorldGuard],
    canDeactivate: [clearActiveWorld],
    loadComponent: () => import('./pages/world/world.page').then((m) => m.WorldPage),
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () =>
          import('./pages/world/pages/world-dashboard/world-dashboard.page').then((m) => m.WorldDashboardPage),
        title: 'worldDashboard.tabTitle',
      },
      {
        // World-level owner management; Owner-only.
        path: 'settings',
        pathMatch: 'full',
        loadComponent: () =>
          import('./pages/world/pages/world-settings/world-settings.page').then((m) => m.WorldSettingsPage),
        // The page names its open section into `tabTitleNamed`; `title` is the fallback until it does.
        title: 'worldSettings.tabTitle',
        data: { documentTitleKey: 'worldSettings.tabTitleNamed' },
      },
      {
        path: 'entities',
        pathMatch: 'full',
        loadComponent: () => import('./pages/entity-browser/entity-browser.page').then((m) => m.EntityBrowserPage),
        title: 'entityBrowser.tabTitle',
      },
      {
        // The Compendium browse (ADR-0079, #401): the Entity Browser preset to the installed packs —
        // reference material, Instance-wide, unioned behind a Compendium facet. The `:worldId` above
        // names the adoption target rather than the content's home, which is what makes this a World
        // route at all: nothing here lives in that World.
        path: 'compendium',
        pathMatch: 'full',
        loadComponent: () =>
          import('./pages/compendium-browser/compendium-browser.page').then((m) => m.CompendiumBrowserPage),
        title: 'compendium.tabTitle',
      },
      {
        // The Compendium page (ADR-0061, #402): one installed pack's own terms, nested under the browse
        // it is reached from and readable by anyone signed in, like the entries themselves (ADR-0078).
        path: 'compendium/:compendiumId',
        pathMatch: 'full',
        loadComponent: () => import('./pages/compendium-page/compendium.page').then((m) => m.CompendiumPage),
        // The page names itself in the tab once loaded; `title` is the fallback until it does.
        title: 'compendium.page.tabTitle',
        data: { documentTitleKey: 'compendium.page.tabTitleNamed' },
      },
      {
        // The Asset Browser (ADR-0065, #282): the Entity Browser preset to the asset type — a World's
        // uploaded media as thumbnail tiles, with upload at hand.
        path: 'assets',
        pathMatch: 'full',
        loadComponent: () => import('./pages/asset-browser/asset-browser.page').then((m) => m.AssetBrowserPage),
        title: 'assetBrowser.tabTitle',
      },
      {
        // The World Graph (#181). Lazy on its own chunk: cosmos.gl is ~168 kB gzip
        // of WebGL that nothing outside this page needs.
        path: 'graph',
        pathMatch: 'full',
        loadComponent: () => import('./pages/world/pages/world-graph/world-graph.page').then((m) => m.WorldGraphPage),
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
        loadChildren: () => import('./pages/entity/entity.routes').then((m) => m.ENTITY_ROUTES),
      },
    ],
  },
  {
    // World-agnostic Entity link target: a Content Link can cross Worlds, so this
    // route resolves the target's World by id and redirects to the canonical
    // `/w/:worldId/entities/:id`; a missing/inaccessible target renders the error page.
    path: 'entities/:id',
    canActivate: [authGuard, entityWorldRedirect],
    loadComponent: () => import('./pages/error/error.page').then((m) => m.ErrorPage),
    title: 'error.tabTitle',
  },
  {
    path: 'styleguide',
    loadComponent: () => import('./pages/styleguide/styleguide.page').then((m) => m.StyleguidePage),
    title: 'styleguide.tabTitle',
  },
  // Unauthenticated Public Link surface: token-scoped, read-only. Deliberately
  // outside authGuard — possession of the token is the credential — but on the
  // Collaboration cut list (ADR-0071): with the layer off no token can exist.
  {
    path: 'public/e/:token',
    canActivate: [collaborationGuard],
    data: { mode: 'entity' },
    loadComponent: () => import('./pages/public/public-entity.page').then((m) => m.PublicEntityPage),
    title: 'publicView.tabTitle',
  },
  {
    path: 'public/w/:token',
    canActivate: [collaborationGuard],
    loadComponent: () => import('./pages/public/public-world.page').then((m) => m.PublicWorldPage),
    title: 'publicView.tabTitle',
  },
  {
    // `:entityId` (not `:id`) keeps the reused EntityPage's watchRoute from matching;
    // PublicEntityPage marks the session externally driven and is the sole data source.
    path: 'public/w/:token/e/:entityId',
    canActivate: [collaborationGuard],
    data: { mode: 'worldEntity' },
    loadComponent: () => import('./pages/public/public-entity.page').then((m) => m.PublicEntityPage),
    title: 'publicView.tabTitle',
  },
  // Unmatched URLs render the error page rather than bouncing to the Index, so a
  // wrong URL is visible, not papered over.
  {
    path: '**',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/error/error.page').then((m) => m.ErrorPage),
    title: 'error.tabTitle',
  },
];
