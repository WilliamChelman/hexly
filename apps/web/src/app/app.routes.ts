import { Route } from '@angular/router';
import { authGuard, loginGuard } from './auth/auth.guard';
import { EditorSession } from './editor-shell/editor-session';

export const appRoutes: Route[] = [
  {
    path: 'login',
    canActivate: [loginGuard],
    loadComponent: () => import('./auth/login').then((m) => m.Login),
    // Title key resolved by TranslationTitleStrategy to the "Hexly" brand (ADR-0014).
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
    // Title key resolved by TranslationTitleStrategy to the "Hexly" brand (ADR-0014).
    title: 'entityBrowser.tabTitle',
  },
  {
    // The open-Entity route (#70). The id is in the URL so a reload reopens the
    // same Entity (#6). A component-less route fans its two empty-path children
    // into the root shell's two outlets at once (ADR-0015): EntityPage into the
    // primary outlet, EntityHeader into AppHeader's named `header` outlet.
    path: 'entities/:id',
    canActivate: [authGuard],
    // One EditorSession for the subtree, shared by both outlets; destroyed on
    // leave, so open-Entity state resets implicitly (#70).
    providers: [EditorSession],
    // Tab title is the open Entity's name composed with the brand ("Aldermoor —
    // Hexly") via documentTitleKey; `title` is the pre-load fallback (ADR-0014).
    title: 'editorShell.tabTitle',
    data: { documentTitleKey: 'editorShell.tabTitleNamed' },
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/entity/entity.page').then((m) => m.EntityPage),
      },
      {
        path: '',
        outlet: 'header',
        loadComponent: () =>
          import('./pages/entity/entity-header').then((m) => m.EntityHeader),
      },
    ],
  },
  // Landing goes to the library.
  { path: '', pathMatch: 'full', redirectTo: 'entities' },
  {
    path: 'styleguide',
    loadComponent: () =>
      import('./styleguide/styleguide').then((m) => m.Styleguide),
    // Title key resolved by TranslationTitleStrategy to the "Hexly" brand (ADR-0014).
    title: 'styleguide.tabTitle',
  },
  { path: '**', redirectTo: 'entities' },
];
