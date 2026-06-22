import { Route } from '@angular/router';
import { authGuard, loginGuard } from './auth/auth.guard';

export const appRoutes: Route[] = [
  {
    path: 'login',
    canActivate: [loginGuard],
    loadComponent: () => import('./auth/login').then((m) => m.Login),
    // A translation key resolved by TranslationTitleStrategy; the value carries
    // the untranslated "Hexly" brand (ADR-0014).
    title: 'auth.tabTitle',
  },
  {
    // The library: every map the user owns, plus open / create / delete.
    path: 'maps',
    pathMatch: 'full',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./map-library/map-library').then((m) => m.MapLibrary),
    // A translation key resolved by TranslationTitleStrategy; the value carries
    // the untranslated "Hexly" brand (ADR-0014).
    title: 'mapLibrary.tabTitle',
  },
  {
    // The editor for a specific map. The id is in the URL so a reload reopens
    // the same map (issue #6). This does not collide with the API: the backend
    // lives under `/api/*` (only `/api` is proxied), so `/maps/:id` is a pure
    // client route served by the SPA shell.
    //
    // A component-less route with two empty-path children fills the root shell's
    // two outlets at once (ADR-0015): EditorShell into the primary outlet, and
    // the editor's interactive header into AppHeader's named `header` outlet.
    path: 'maps/:id',
    canActivate: [authGuard],
    // The tab title is the open map's name composed with the brand
    // ("Aldermoor — Hexly"): TranslationTitleStrategy fills `documentTitleKey`'s
    // `{{name}}` slot from the open document. `title` is the fallback shown until
    // the map loads — the bare "Hexly" brand, untranslated in every language
    // (ADR-0014).
    title: 'editorShell.tabTitle',
    data: { documentTitleKey: 'editorShell.tabTitleNamed' },
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./editor-shell/editor-shell').then((m) => m.EditorShell),
      },
      {
        path: '',
        outlet: 'header',
        loadComponent: () =>
          import('./editor-shell/editor-header').then((m) => m.EditorHeader),
      },
    ],
  },
  // Landing goes to the library.
  { path: '', pathMatch: 'full', redirectTo: 'maps' },
  {
    path: 'styleguide',
    loadComponent: () =>
      import('./styleguide/styleguide').then((m) => m.Styleguide),
    // A translation key resolved by TranslationTitleStrategy; the value carries
    // the untranslated "Hexly" brand (ADR-0014).
    title: 'styleguide.tabTitle',
  },
  { path: '**', redirectTo: 'maps' },
];
