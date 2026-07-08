import { Routes } from '@angular/router';
import { EntityNameResolver, CONTENT_EDITOR_SESSION } from '@hexly/content-editor';
import { flushOnLeave } from './flush-on-leave.guard';
import { EntitySession } from './services/entity-session';
import { OutlineStore } from './services/outline-store';

/**
 * Lazy route config for `/w/:worldId/entities/:id`. Split out of app.routes so the
 * editor's providers — and the ContentEditor barrel (TipTap) they reference — load
 * with the entity chunk, never the initial bundle. The parent route keeps
 * `reconcileWorldSegment`: its parent is still `w/:worldId`, where the segment lives.
 */
export const ENTITY_ROUTES: Routes = [
  {
    // Empty path: inherits `:id` from the parent segment (emptyOnly strategy).
    path: '',
    // Await a pending autosave so in-app navigation never drops a debounced edit.
    canDeactivate: [flushOnLeave],
    // Route-scoped: one EntitySession per open Entity, destroyed on leave;
    // EntityNameResolver's id→name cache resets with it.
    providers: [
      EntitySession,
      { provide: CONTENT_EDITOR_SESSION, useExisting: EntitySession },
      EntityNameResolver,
      OutlineStore,
    ],
    // documentTitleKey composes the Entity name with the brand; `title` is the
    // pre-load fallback.
    title: 'editorShell.tabTitle',
    data: { documentTitleKey: 'editorShell.tabTitleNamed' },
    loadComponent: () => import('./entity.page').then((m) => m.EntityPage),
  },
];
