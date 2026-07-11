import { Routes } from '@angular/router';
import { EntityNameResolver, CONTENT_EDITOR_SESSION } from '@hexly/content-editor';
import { HexMapStore } from '@hexly/web-map';
import { flushOnLeave } from './flush-on-leave.guard';
import { EntitySession } from './services/entity-session';
import { GRID_STORE } from './services/grid-store.port';

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
    // EntityNameResolver's id→name cache resets with it. The right dock's own stores are
    // component-scoped on EntityPage, which is the only thing that shows them.
    providers: [
      EntitySession,
      { provide: CONTENT_EDITOR_SESSION, useExisting: EntitySession },
      // Bind the hex-grid editor to the port the session depends on (ADR-0048); kept
      // in the lazy entity chunk so web-map never reaches the initial bundle.
      { provide: GRID_STORE, useExisting: HexMapStore },
      EntityNameResolver,
    ],
    // documentTitleKey composes the Entity name with the brand; `title` is the
    // pre-load fallback.
    title: 'editorShell.tabTitle',
    data: { documentTitleKey: 'editorShell.tabTitleNamed' },
    loadComponent: () => import('./entity.page').then((m) => m.EntityPage),
  },
];
