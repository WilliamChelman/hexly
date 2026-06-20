import { Route } from '@angular/router';
import { authGuard, loginGuard } from './auth/auth.guard';

export const appRoutes: Route[] = [
  {
    path: 'login',
    canActivate: [loginGuard],
    loadComponent: () => import('./auth/login').then((m) => m.Login),
    title: 'Hexly — Sign in',
  },
  {
    // The library: every map the user owns, plus open / create / delete.
    path: 'maps',
    pathMatch: 'full',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./map-library/map-library').then((m) => m.MapLibrary),
    title: 'Hexly — Your maps',
  },
  {
    // The editor for a specific map. The id is in the URL so a reload reopens
    // the same map (issue #6). This does not collide with the API: the backend
    // lives under `/api/*` (only `/api` is proxied), so `/maps/:id` is a pure
    // client route served by the SPA shell.
    path: 'maps/:id',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./editor-shell/editor-shell').then((m) => m.EditorShell),
    title: 'Hexly',
  },
  // Landing goes to the library.
  { path: '', pathMatch: 'full', redirectTo: 'maps' },
  {
    path: 'styleguide',
    loadComponent: () =>
      import('./styleguide/styleguide').then((m) => m.Styleguide),
    title: 'Hexly — Design system',
  },
  { path: '**', redirectTo: 'maps' },
];
