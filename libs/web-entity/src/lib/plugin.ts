import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import { StructuredDataType } from '@hexly/domain';
import { TranslationScope, provideEagerTranslations } from '@hexly/web-core';
import { TypeDefinition } from './type-definition';
import { ViewDefinition } from './view-definition';

/**
 * What a bundled plugin contributes to the web app (ADR-0048): its Entity Types, the Views those types
 * afford, the **Structured Field** data-types those types declare (ADR-0050), and its own copy (ADR-0049).
 */
export interface WebPlugin {
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
 * A bundled plugin's single entry point into the app (ADR-0048): a plugin exports one
 * `providePluginX()` built from this, and the app names it in `app.config.ts`. "Bundled" means
 * compiled-in — there are no runtime third-party plugins — so a plugin joins by shipping a lib and
 * being provided here.
 */
export function providePlugin({
  types = [],
  views = [],
  dataTypes = [],
  translations,
}: WebPlugin): EnvironmentProviders {
  return makeEnvironmentProviders([
    types.map((type) => ({ provide: PLUGIN_TYPES, useValue: type, multi: true })),
    views.map((view) => ({ provide: PLUGIN_VIEWS, useValue: view, multi: true })),
    dataTypes.map((dataType) => ({ provide: PLUGIN_DATA_TYPES, useValue: dataType, multi: true })),
    translations ? provideEagerTranslations(translations) : [],
  ]);
}
