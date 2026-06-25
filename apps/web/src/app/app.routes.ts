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
    // The Entity browser: every Entity the user owns — notes and maps — plus
    // open / create / rename / delete (#70).
    path: 'entities',
    pathMatch: 'full',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./entity-browser/entity-browser').then((m) => m.EntityBrowser),
    // A translation key resolved by TranslationTitleStrategy; the value carries
    // the untranslated "Hexly" brand (ADR-0014).
    title: 'entityBrowser.tabTitle',
  },
  {
    // The one open-Entity route (#70). The id is in the URL so a reload reopens
    // the same Entity (issue #6). This does not collide with the API: the backend
    // lives under `/api/*` (only `/api` is proxied), so `/entities/:id` is a pure
    // client route served by the SPA shell.
    //
    // A component-less route with two empty-path children fills the root shell's
    // two outlets at once (ADR-0015): EntityShell into the primary outlet and
    // EntityHeader into AppHeader's named `header` outlet. Each dispatches by the
    // loaded Entity's type — a hexmap renders the map editor (and its interactive
    // header), a note the minimal note view.
    path: 'entities/:id',
    canActivate: [authGuard],
    // The tab title is the open Entity's name composed with the brand
    // ("Aldermoor — Hexly"): TranslationTitleStrategy fills `documentTitleKey`'s
    // `{{name}}` slot from the open document. `title` is the fallback shown until
    // it loads — the bare "Hexly" brand, untranslated in every language
    // (ADR-0014).
    title: 'editorShell.tabTitle',
    data: { documentTitleKey: 'editorShell.tabTitleNamed' },
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./entity-shell/entity-shell').then((m) => m.EntityShell),
      },
      {
        path: '',
        outlet: 'header',
        loadComponent: () =>
          import('./entity-shell/entity-header').then((m) => m.EntityHeader),
      },
    ],
  },
  // Landing goes to the library.
  { path: '', pathMatch: 'full', redirectTo: 'entities' },
  {
    path: 'styleguide',
    loadComponent: () =>
      import('./styleguide/styleguide').then((m) => m.Styleguide),
    // A translation key resolved by TranslationTitleStrategy; the value carries
    // the untranslated "Hexly" brand (ADR-0014).
    title: 'styleguide.tabTitle',
  },
  { path: '**', redirectTo: 'entities' },
];
