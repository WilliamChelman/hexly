import { Route } from '@angular/router';
import { authGuard } from './auth/auth.guard';

export const appRoutes: Route[] = [
  {
    path: 'login',
    loadComponent: () => import('./auth/login').then((m) => m.Login),
    title: 'Hexly — Sign in',
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./editor-shell/editor-shell').then((m) => m.EditorShell),
    title: 'Hexly',
  },
  {
    path: 'styleguide',
    loadComponent: () =>
      import('./styleguide/styleguide').then((m) => m.Styleguide),
    title: 'Hexly — Design system',
  },
  { path: '**', redirectTo: '' },
];
