import { InjectionToken, Type } from '@angular/core';
import { StructuredDataTypeId } from '@hexly/domain';
import { ViewId } from './view-instance';

/**
 * A **View** id — an open, `core.view.*`-style namespaced key identifying a togglable renderer+editor
 * an Entity affords (ADR-0048, *Views* amendment). Declared in `view-instance.ts` beside the
 * {@link ViewInstance} it keys, which is framework-free so the e2e suite can share the codec.
 *
 * Views are their own keyspace, distinct from Entity Type ids (`core.note`, `dnd.monster`) and from
 * the Field data-type ids a **Structured Field** names (`core.hex-grid`): the `core.view.*`
 * sub-namespace keeps a View id from ever being mistaken for either (ADR-0050). Supersedes the map lib's
 * old two-member `EntityView` union, which was an app-shell concern squatting in the map lib.
 */
export type { ViewId };

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
 * One entry in a Type's ordered {@link TypeDefinition.views} list: either a View id the Type
 * contributes outright, or a reference to one of *its own* Fields — whose data-type contributes the
 * View (ADR-0050). So a Type **places** a Structured Field's View in its own order: `core.hexmap`
 * declares `[{ field: 'grid' }, CORE_VIEW_CONTENT]` and so still opens on its map, while a
 * `world.deity` with a battlemap opens on its Fields.
 *
 * Ordering a Field's View implicitly — always first, or always last — is wrong in both directions: it
 * would open a deity on its battlemap.
 */
export type ViewPlacement = ViewId | { readonly field: string };

/**
 * The Metadata key of the **Structured Field** the active View renders, provided by {@link EntityPage}
 * into the injector it outlets that View's component with. `MapView` and its `HexMapStore` read the
 * grid at *this* key, so two grids on one Entity get one store each.
 *
 * A DI token rather than the component `@Input` ADR-0050 sketched, because a Structured Field's View
 * provides its store in `providers` — constructed before an input is ever set. The outlet mints a
 * fresh injector per View instance, so switching from one grid to another rebuilds the component and
 * its store rather than re-pointing a live one (and its undo stack) at a different Field.
 */
export const VIEW_FIELD_KEY = new InjectionToken<string>('hexly.view.fieldKey');

/**
 * One View's registration in the {@link ViewRegistry}: the id, what labels its header-toggle button,
 * and the component the entity page outlets when this View is active.
 *
 * A View is contributed **either by a Type or by a Structured Field's data-type** (CONTEXT.md → View),
 * and which it is decides how it is labelled — so the two are alternatives here, not a required key
 * beside an optional one:
 *
 * - A **Type's** View — a plugin's stat block, the generic Field view, the Content view every Entity
 *   affords — is one thing an Entity either shows or does not, so it carries its own translated
 *   `labelKey`.
 * - A **data-type's** View is bound to the Field that placed it, and takes that **Field's** label
 *   ("Grid", "Battlemap") — the only thing that tells one grid from another when an Entity carries
 *   two (ADR-0050, #200). A `labelKey` on it would be copy nothing could ever render.
 *
 * The component is declared either eagerly (`component`) or deferred (`loadComponent`),
 * the same pair as an Angular `Route`. Which one to use follows from *where the
 * definition is registered*, not from the view's weight: `component` for a View
 * registered from the lazy entity chunk, whose body already ships there (the core
 * Views); `loadComponent` for one registered at bootstrap, where an eager class
 * reference would drag the body onto the initial bundle (a plugin's, via
 * {@link providePlugin}). Either way the id and the label are known up front, so the
 * header's view toggle can label a View it has not fetched.
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
      readonly labelKey?: never;
      /**
       * The **Structured Field** data-type this View renders (`core.hex-grid`). This is the whole of
       * the Field→View binding: a Type places one of its Fields in {@link TypeDefinition.views}, the
       * Field names its data-type by `kind`, and the kind resolves here — so a plugin registers its
       * View exactly as it always did, and no registry learns that a grid in particular has one.
       *
       * The framework-free half of a data-type ({@link StructuredDataType}) carries no View, because
       * the API has none; this is the web half of the same declaration.
       */
      readonly dataType: StructuredDataTypeId;
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
