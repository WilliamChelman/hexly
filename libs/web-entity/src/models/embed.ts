import { InjectionToken, Type } from '@angular/core';
import { Observable } from 'rxjs';
import { ViewInstance } from '../utils/view-instance';

/**
 * The render context an Entity View Outlet carries down the transclusion chain (ADR-0062): the ancestor
 * Entity-id chain that bounds cycles, plus the current nesting depth and the configurable cap past which
 * an Embed degrades to a card preview.
 *
 * Lives in `web-entity` (not the app) so a plugin that *renders* an Embed — the Board (`plugin-board-web`)
 * — can advance and pass this context without importing app code (ADR-0048): plugin-board-web can neither
 * import the app's Entity View Outlet nor the app's context type, so both cross through this shared seam.
 */
export interface EntityRenderContext {
  /** The Entity-id chain from the root to this outlet's parent — a target already in it is a cycle. */
  readonly ancestorIds: readonly string[];
  /** This outlet's nesting depth; the root page renders at 0. */
  readonly depth: number;
  /** The nesting cap: at or past it, the outlet degrades to the card preview (ADR-0062, default 3). */
  readonly maxDepth: number;
}

/** The top-of-page context: no ancestors, depth 0, and the ADR-0062 default cap — so the page never degrades. */
export const DEFAULT_ENTITY_RENDER_CONTEXT: EntityRenderContext = { ancestorIds: [], depth: 0, maxDepth: 3 };

/**
 * The render context in scope for the View an Entity View Outlet is hosting (ADR-0062): the outlet
 * provides its own context here, so a transcluded surface's own Embeds read where they sit and advance
 * it by one level. Absent at the page root — a consumer falls back to {@link DEFAULT_ENTITY_RENDER_CONTEXT}.
 */
export const ENTITY_RENDER_CONTEXT = new InjectionToken<EntityRenderContext>('ENTITY_RENDER_CONTEXT');

/**
 * The Entity View Outlet host component (Seam C, #264/#270): the app binds its outlet host here so a
 * plugin can transclude another Entity's View through it without importing the app (ADR-0048). The
 * component accepts three inputs — `entityId` (the target), `viewKey` (a {@link ViewInstance} key naming
 * which View, or `''` for the target's default), and `renderContext` — and self-provides a read-only,
 * transclusion-scoped session so its fetch never disturbs the host page's open Entity.
 */
export const ENTITY_VIEW_OUTLET = new InjectionToken<Type<unknown>>('ENTITY_VIEW_OUTLET');

/** One selectable View of an Embed target — its {@link ViewInstance} and a display label resolved app-side. */
export interface EntityViewChoice {
  /** The View instance the Embed pins when this choice is picked. */
  readonly view: ViewInstance;
  /** Its display label (already translated) — the Views the app's registries afford this target. */
  readonly label: string;
}

/**
 * Resolve the Views an Embed may render its `entityId` target through (ADR-0062): the target's afforded
 * View set, each with a display label. The app binds this — it owns the Type/View registries a plugin
 * cannot reach — and a plugin's Embed picker/inspector consumes it. Errors (unreadable target) resolve
 * to an empty list, so the picker offers only the target's default View.
 */
export type EntityViewChoicesProvider = (entityId: string) => Observable<readonly EntityViewChoice[]>;

/** DI token for the {@link EntityViewChoicesProvider}; the app binds the concrete resolver to it. */
export const ENTITY_VIEW_CHOICES = new InjectionToken<EntityViewChoicesProvider>('ENTITY_VIEW_CHOICES');
