import { Route } from '@angular/router';
import { authGuard, loginGuard } from './core/guards/auth.guard';
import {
  activeWorldResolver,
  clearActiveWorld,
} from './core/services/active-world';
import { flushOnLeave } from './pages/entity/flush-on-leave.guard';
import { EntitySession } from './pages/entity/services/entity-session';
import { EntityNameResolver } from './pages/entity/services/entity-name-resolver';

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
        // Await a pending autosave before leaving the route, so an in-app navigation
        // never drops a debounced edit (ADR-0026).
        canDeactivate: [flushOnLeave],
        // One EntitySession for the subtree, destroyed on leave, so open-Entity state
        // resets implicitly (#70). EntityNameResolver batches id→name lookups for the
        // entityLink node views (the `@` picker searches the server directly); route-scoped
        // so navigating to another Entity re-resolves names against a fresh cache (ADR-0023).
        providers: [EntitySession, EntityNameResolver],
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
    path: 'styleguide',
    loadComponent: () =>
      import('./pages/styleguide/styleguide').then((m) => m.Styleguide),
    // Title key resolved by TranslationTitleStrategy to the "Hexly" brand (ADR-0014).
    title: 'styleguide.tabTitle',
  },
  // Anything unmatched falls back to the World Index (ADR-0028).
  { path: '**', redirectTo: '' },
];
