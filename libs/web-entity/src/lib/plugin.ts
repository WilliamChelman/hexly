import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import { StructuredDataType } from '@hexly/domain';
import { TranslationScope, provideEagerTranslations } from '@hexly/web-core';
import { TypeDefinition } from './type-definition';
import { ViewDefinition, ViewId } from './view-definition';

/**
 * What a bundled plugin contributes to the web app (ADR-0048): its Entity Types, the Views those types
 * afford, the **Structured Field** data-types those types declare (ADR-0050), and its own copy (ADR-0049).
 */
export interface WebPlugin {
  /** This plugin's canonical `PLUGIN_ID` (ADR-0052); the server twin `ServerPlugin` carries the same value. */
  readonly id: string;
  readonly types?: readonly TypeDefinition[];
  /**
   * Declare these with `loadComponent`, not `component`: they register in the root injector, so an
   * eager class reference would put the view body on the initial bundle.
   */
  readonly views?: readonly ViewDefinition[];
  /**
   * The data-types a **Structured Field** of this plugin's types names by `kind` — the grid behind
   * `core.hexmap`'s `grid` Field (ADR-0050). The web composes its resolved set from these.
   */
  readonly dataTypes?: readonly StructuredDataType[];
  /** Eager, because a type's chrome labels are transloco keys (ADR-0049). */
  readonly translations?: TranslationScope;
}

/** The bundled plugins' ids (ADR-0052), one multi-provider entry per `providePlugin()`. */
export const PLUGIN_IDS = new InjectionToken<readonly string[]>('hexly.plugin.ids');

/** The bundled plugins' {@link TypeDefinition}s, read by the root `TypeRegistry`. */
export const PLUGIN_TYPES = new InjectionToken<readonly TypeDefinition[]>('hexly.plugin.types');

/** The bundled plugins' {@link ViewDefinition}s, read by the root `ViewRegistry`. */
export const PLUGIN_VIEWS = new InjectionToken<readonly ViewDefinition[]>('hexly.plugin.views');

/**
 * The bundled plugins' {@link StructuredDataType}s, resolved into one set by the root `TypeRegistry`
 * and threaded from there into the domain's `validateFields` / `withFieldDefaults` (ADR-0050) — the
 * domain holds no global registry of its own.
 */
export const PLUGIN_DATA_TYPES = new InjectionToken<readonly StructuredDataType[]>('hexly.plugin.dataTypes');

/**
 * Which bundled Plugin owns each contributed Entity Type, as `[typeId, PLUGIN_ID]` tuples (ADR-0052,
 * Seam 3) — the web mirror of the server's `BUNDLED_PLUGIN_TYPE_OWNERS`. The `TypeRegistry` folds these
 * into a map so it can drop a *disabled* Plugin's Types against the enabled-set signal, while a Type with
 * no owner (a World's user-defined one, registered at runtime) is never Plugin-gated.
 */
export const PLUGIN_TYPE_OWNERS = new InjectionToken<readonly (readonly [string, string])[]>('hexly.plugin.typeOwners');

/**
 * Which bundled Plugin owns each contributed {@link ViewDefinition}, as `[viewId, PLUGIN_ID]` tuples
 * (ADR-0052, Seam 3). The `ViewRegistry` folds these into a map so a disabled Plugin's Views — and the
 * data-types they render — fall away, while the app-owned core Views (registered with no owner) stay.
 */
export const PLUGIN_VIEW_OWNERS = new InjectionToken<readonly (readonly [ViewId, string])[]>('hexly.plugin.viewOwners');

/**
 * A bundled plugin's single entry point into the app (ADR-0048): a plugin exports one
 * `providePluginX()` built from this, and the app names it in `app.config.ts`. "Bundled" means
 * compiled-in — there are no runtime third-party plugins — so a plugin joins by shipping a lib and
 * being provided here.
 */
export function providePlugin({
  id,
  types = [],
  views = [],
  dataTypes = [],
  translations,
}: WebPlugin): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: PLUGIN_IDS, useValue: id, multi: true },
    types.map((type) => ({ provide: PLUGIN_TYPES, useValue: type, multi: true })),
    views.map((view) => ({ provide: PLUGIN_VIEWS, useValue: view, multi: true })),
    dataTypes.map((dataType) => ({ provide: PLUGIN_DATA_TYPES, useValue: dataType, multi: true })),
    // The ownership tuples the registries filter enablement by (ADR-0052): each contribution's id
    // paired with this Plugin's id, so a disabled Plugin's Types and Views can be dropped by owner.
    types.map((type) => ({ provide: PLUGIN_TYPE_OWNERS, useValue: [type.id, id] as const, multi: true })),
    views.map((view) => ({ provide: PLUGIN_VIEW_OWNERS, useValue: [view.id, id] as const, multi: true })),
    translations ? provideEagerTranslations(translations) : [],
  ]);
}
