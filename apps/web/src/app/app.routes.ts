import { Route } from '@angular/router';
import { adminGuard, authGuard, loginGuard, entityWorldRedirect, reconcileWorldSegment, activeWorldGuard, clearActiveWorld } from '@hexly/web-core';
import { flushOnLeave } from './pages/entity/flush-on-leave.guard';
import { EntitySession } from './pages/entity/services/entity-session';
import { EntityNameResolver } from './pages/entity/services/entity-name-resolver';
import { OutlineStore } from './pages/entity/services/outline-store';

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
    // Account-scoped like Settings. The server re-checks every action.
    path: 'admin',
    canActivate: [adminGuard],
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
        path: 'entities/:id',
        // Reconcile a stale/hand-edited World segment against the Entity's real
        // world_id, redirecting to the correct World on mismatch.
        canActivate: [reconcileWorldSegment],
        // Await a pending autosave so in-app navigation never drops a debounced edit.
        canDeactivate: [flushOnLeave],
        // Route-scoped: one EntitySession per open Entity, destroyed on leave;
        // EntityNameResolver's id→name cache resets with it.
        providers: [EntitySession, EntityNameResolver, OutlineStore],
        // documentTitleKey composes the Entity name with the brand; `title` is
        // the pre-load fallback.
        title: 'editorShell.tabTitle',
        data: { documentTitleKey: 'editorShell.tabTitleNamed' },
        loadComponent: () =>
          import('./pages/entity/entity.page').then((m) => m.EntityPage),
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
