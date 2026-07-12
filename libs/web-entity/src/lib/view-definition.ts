import { Type } from '@angular/core';

/**
 * A **View** id — an open, `core.view.*`-style namespaced key identifying a
 * togglable renderer+editor an Entity affords (ADR-0048, *Views* amendment).
 *
 * Views are a *third keyspace*, distinct from Entity Type ids (`core.note`,
 * `dnd.monster`) and the closed Payload Kind names (`rich-content`, `hex-grid`):
 * the `core.view.*` sub-namespace keeps a View id from ever being mistaken for
 * either. Supersedes web-map's old two-member `EntityView` union, which was an
 * app-shell concern squatting in the map lib.
 */
export type ViewId = string;

/** The Content-body View every Entity affords (the `rich-content` base's renderer). */
export const CORE_VIEW_CONTENT = 'core.view.content';
/** The hex-grid View a `hex-grid`-carrying Entity additionally affords. */
export const CORE_VIEW_MAP = 'core.view.map';
/**
 * The **generic Field View** (ADR-0048, #187): renders a type's declared Fields off
 * the Entity's Metadata and edits them back into it. Contributed by any type that
 * declares Fields, and the graceful fallback for an Entity whose type has no
 * registered view (a missing plugin, a World-defined type) — where it shows the type
 * as an inert chip and the values as plain Metadata.
 */
export const CORE_VIEW_FIELDS = 'core.view.fields';

/**
 * One View's registration in the {@link ViewRegistry}: the id, the transloco key
 * for its header-toggle button, and the component the entity page outlets when this
 * View is active. A View is contributed either by a Payload Kind (the two core views)
 * or by a Type (a plugin's bespoke view, the generic Field view).
 *
 * The component is declared either eagerly (`component`) or deferred (`loadComponent`),
 * the same pair as an Angular `Route`. Which one to use follows from *where the
 * definition is registered*, not from the view's weight: `component` for a View
 * registered from the lazy entity chunk, whose body already ships there (the core
 * Views); `loadComponent` for one registered at bootstrap, where an eager class
 * reference would drag the body onto the initial bundle (a plugin's, via
 * {@link providePlugin}). Either way the id and `labelKey` are known up front, so the
 * header's view toggle can label a View it has not fetched.
 */
export type ViewDefinition = {
  readonly id: ViewId;
  /** transloco key for the view-toggle button label (ADR-0014). */
  readonly labelKey: string;
} & (
  | {
      /** The component the {@link EntityPage} host outlets for this View. */
      readonly component: Type<unknown>;
      readonly loadComponent?: never;
    }
  | {
      readonly component?: never;
      /** Fetches that component on first show, keeping its body off the initial bundle. */
      readonly loadComponent: () => Promise<Type<unknown>>;
    }
);
