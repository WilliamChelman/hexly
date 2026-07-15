import { InjectionToken, Type } from '@angular/core';
import { StructuredDataTypeId, ViewPlacement } from '@hexly/domain';
import { ViewId } from './view-instance';

/**
 * A **View** id — an open, `core.view.*`-style namespaced key identifying a togglable renderer+editor
 * an Entity affords (ADR-0048). Its own keyspace, distinct from Entity Type ids (`core.note`) and from
 * the Field data-type ids a **Field of a Structured Data Type** names (`core.hex-grid`).
 */
export type { ViewId };

/** The hex-grid View a `hex-grid`-carrying Entity additionally affords. */
export const CORE_VIEW_MAP = 'core.view.map';
/**
 * The **generic Field View**: renders a type's declared Fields off the Entity's EntityDocument and edits
 * them back into it. Contributed by any type that declares Fields, and the fallback for an Entity
 * whose type has no registered view (a missing plugin, a World-defined type) — where it shows the
 * type as an inert chip and the values as plain EntityDocument.
 */
export const CORE_VIEW_FIELDS = 'core.view.fields';

/**
 * One entry in a Type's ordered {@link TypeDefinition.views} list: either a View id the Type
 * contributes outright, or a reference to one of *its own* Fields, whose data-type contributes the
 * View (ADR-0050).
 *
 * A Type thereby **places** a Structured Data Type's View in its own order — `core.hexmap` declares
 * `[{ field: 'grid' }, CORE_VIEW_CONTENT]`, placing its grid by `{ field }` and the content View by id
 * (ADR-0051). A User-defined type's list is data: persisted, and validated at the trust boundary.
 */
export type { ViewPlacement };

/**
 * The EntityDocument key of the **Field of a Structured Data Type** the active View renders — provided by {@link EntityPage}
 * into the injector it outlets that View's component with, so two grids on one Entity get one store each.
 *
 * A token rather than an `@Input`, because a Structured Data Type's View provides its store in `providers`,
 * which Angular constructs before it sets any input. The page mints a fresh injector per View instance,
 * so switching grids rebuilds the component and its store rather than re-pointing a live one — and its
 * undo stack — at a different Field.
 */
export const VIEW_FIELD_KEY = new InjectionToken<string>('hexly.view.fieldKey');

/**
 * One View's registration in the {@link ViewRegistry}: the id, what labels its header-toggle button,
 * and the component the entity page outlets when this View is active.
 *
 * A View is contributed **either by a Type or by a Structured Data Type**, and that decides
 * how it is labelled: a Type's View carries its own translated `labelKey`; a data-type's View takes
 * the label of the **Field** that placed it, which is the only thing that tells one grid from another.
 *
 * Which of `component` / `loadComponent` to use follows from *where the definition is registered*,
 * not from the view's weight: `component` for a View registered from the lazy entity chunk, whose
 * body already ships there (the core Views); `loadComponent` for one registered at bootstrap, where
 * an eager class reference would drag the body onto the initial bundle (a plugin's, via
 * {@link providePlugin}). Either way the id and the label are known up front, so the header's view
 * toggle can label a View it has not fetched.
 */
export type ViewDefinition = {
  readonly id: ViewId;
} & (
  | {
      /** transloco key for the view-toggle button label (ADR-0014). */
      readonly labelKey: string;
      readonly dataType?: never;
    }
  | {
      /**
       * The toggle label when a Type places this View by *id* rather than by a Field — the content View
       * over a type's one canonical prose Field (ADR-0051). A `{ field }` placement uses the Field's
       * label instead, so it is absent for a View only ever placed that way (the map).
       */
      readonly labelKey?: string;
      /**
       * The **Structured Data Type** this View renders (`core.hex-grid`, `core.rich-content`): a
       * Type places one of its Fields, the Field names its data-type by `kind`, and the kind resolves
       * here. The web half of a data-type's declaration; the framework-free half
       * ({@link StructuredDataType}) carries no View.
       */
      readonly dataType: StructuredDataTypeId;
      /**
       * The transloco key naming the **data-type** ("Hex grid", "Prose") where the World Types editor
       * offers it, beside `string` and `enum`. Distinct from the toggle label, which a structured View
       * takes from the Field that placed it ("Battlemap").
       */
      readonly dataTypeLabelKey: string;
    }
) &
  (
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
