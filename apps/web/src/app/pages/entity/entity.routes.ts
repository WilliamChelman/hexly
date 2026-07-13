import { Routes } from '@angular/router';
import { EntityNameResolver, CONTENT_EDITOR_SESSION } from '@hexly/content-editor';
import { ENTITY_SESSION } from '@hexly/web-entity';
import { flushOnLeave } from './flush-on-leave.guard';
import { EntitySession } from './services/entity-session';

/**
 * Lazy route config for `/w/:worldId/entities/:id`. Kept out of app.routes so the editor's
 * providers — and the ContentEditor barrel (TipTap) they reference — load with the entity
 * chunk, never the initial bundle.
 */
export const ENTITY_ROUTES: Routes = [
  {
    // Empty path: inherits `:id` from the parent segment (emptyOnly strategy).
    path: '',
    // Await a pending autosave so in-app navigation never drops a debounced edit.
    canDeactivate: [flushOnLeave],
    // Route-scoped: one EntitySession per open Entity, destroyed on leave;
    // EntityNameResolver's id→name cache resets with it. The right dock's own stores are
    // component-scoped on EntityPage, which is the only thing that shows them.
    providers: [
      EntitySession,
      // The session is the central store every View edits; bind the token to it so the map lib
      // (and future Views) reach it without importing the app (ADR-0048).
      { provide: ENTITY_SESSION, useExisting: EntitySession },
      { provide: CONTENT_EDITOR_SESSION, useExisting: EntitySession },
      EntityNameResolver,
    ],
    // documentTitleKey composes the Entity name with the brand; `title` is the
    // pre-load fallback.
    title: 'editorShell.tabTitle',
    data: { documentTitleKey: 'editorShell.tabTitleNamed' },
    loadComponent: () => import('./entity.page').then((m) => m.EntityPage),
  },
];
