import { Route } from '@angular/router';
import { authGuard, loginGuard } from './core/guards/auth.guard';
import { flushOnLeave } from './pages/entity/flush-on-leave.guard';
import { EntitySession } from './pages/entity/services/entity-session';

export const appRoutes: Route[] = [
  {
    path: 'login',
    canActivate: [loginGuard],
    loadComponent: () => import('./pages/login/login').then((m) => m.Login),
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
      import('./pages/entity-browser/entity-browser').then(
        (m) => m.EntityBrowser,
      ),
    // Title key resolved by TranslationTitleStrategy to the "Hexly" brand (ADR-0014).
    title: 'entityBrowser.tabTitle',
  },
  {
    // The open-Entity route (#70). The id is in the URL so a reload reopens the
    // same Entity (#6). The routed page renders its own header now (ADR-0022):
    // EditorShell for a hexmap, NoteView for a note.
    path: 'entities/:id',
    canActivate: [authGuard],
    // Await a pending autosave before leaving the route, so an in-app navigation never
    // drops a debounced edit (ADR-0026).
    canDeactivate: [flushOnLeave],
    // One EntitySession for the subtree, destroyed on leave, so open-Entity state
    // resets implicitly (#70).
    providers: [EntitySession],
    // Tab title is the open Entity's name composed with the brand ("Aldermoor —
    // Hexly") via documentTitleKey; `title` is the pre-load fallback (ADR-0014).
    title: 'editorShell.tabTitle',
    data: { documentTitleKey: 'editorShell.tabTitleNamed' },
    loadComponent: () =>
      import('./pages/entity/entity.page').then((m) => m.EntityPage),
  },
  { path: '', pathMatch: 'full', redirectTo: 'entities' },
  {
    path: 'styleguide',
    loadComponent: () =>
      import('./pages/styleguide/styleguide').then((m) => m.Styleguide),
    // Title key resolved by TranslationTitleStrategy to the "Hexly" brand (ADR-0014).
    title: 'styleguide.tabTitle',
  },
  { path: '**', redirectTo: 'entities' },
];
