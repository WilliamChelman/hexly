import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import { TranslationScope, provideEagerTranslations } from '@hexly/web-core';
import { TypeDefinition } from './type-definition';
import { ViewDefinition } from './view-definition';

/**
 * What a bundled plugin contributes to the web app (ADR-0048): its Entity Types, the Views those
 * types afford, and its own copy (ADR-0049).
 */
export interface WebPlugin {
  readonly types?: readonly TypeDefinition[];
  /**
   * Declare these with `loadComponent`, not `component`: they register in the root injector, so an
   * eager class reference would put the view body on the initial bundle.
   */
  readonly views?: readonly ViewDefinition[];
  /** Eager, because a type's chrome labels are transloco keys (ADR-0049). */
  readonly translations?: TranslationScope;
}

/** The bundled plugins' {@link TypeDefinition}s, read by the root `TypeRegistry`. */
export const PLUGIN_TYPES = new InjectionToken<readonly TypeDefinition[]>('hexly.plugin.types');

/** The bundled plugins' {@link ViewDefinition}s, read by the root `ViewRegistry`. */
export const PLUGIN_VIEWS = new InjectionToken<readonly ViewDefinition[]>('hexly.plugin.views');

/**
 * A bundled plugin's single entry point into the app (ADR-0048): a plugin exports one
 * `providePluginX()` built from this, and the app names it in `app.config.ts`. The registries seed
 * themselves from the tokens below, so they never learn a plugin's name.
 *
 * "Bundled" means compiled-in — the ADR rules out runtime third-party plugins — so a plugin joins by
 * shipping a lib and being provided here.
 */
export function providePlugin({ types = [], views = [], translations }: WebPlugin): EnvironmentProviders {
  return makeEnvironmentProviders([
    types.map((type) => ({ provide: PLUGIN_TYPES, useValue: type, multi: true })),
    views.map((view) => ({ provide: PLUGIN_VIEWS, useValue: view, multi: true })),
    translations ? provideEagerTranslations(translations) : [],
  ]);
}
