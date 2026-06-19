import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  {
    path: '',
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
