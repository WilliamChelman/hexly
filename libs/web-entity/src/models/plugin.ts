import { EnvironmentProviders, InjectionToken, makeEnvironmentProviders } from '@angular/core';
import { Field, StructuredDataType } from '@hexly/domain';
import { TranslationScope, provideEagerTranslations } from '@hexly/web-core';
import { TypeDefinition } from './type-definition';
import { ViewDefinition, ViewId } from './view-definition';

/**
 * What a bundled plugin contributes to the web app (ADR-0048): its Entity Types, the Views those types
 * afford, the **Structured Data Types** those types declare (ADR-0050), and its own copy (ADR-0049).
 */
export interface WebPlugin {
  /** This plugin's canonical `PLUGIN_ID` (ADR-0052); the server twin `ServerPlugin` carries the same value. */
  readonly id: string;
  readonly types?: readonly TypeDefinition[];
  /** The code-registered **Plugin Fields** this plugin declares (`defineField`, ADR-0054), folded into the instance-wide id→Field resolver like {@link dataTypes}. */
  readonly fields?: readonly Field[];
  /**
   * Declare these with `loadComponent`, not `component`: they register in the root injector, so an
   * eager class reference would put the view body on the initial bundle.
   */
  readonly views?: readonly ViewDefinition[];
  /**
   * The data-types a **Field of a Structured Data Type** of this plugin's types names by `kind` — the grid behind
   * `core.type.hex-map`'s `grid` Field (ADR-0050). The web composes its resolved set from these.
   */
  readonly dataTypes?: readonly StructuredDataType[];
  /** Eager, because a type's chrome labels are transloco keys (ADR-0049). */
  readonly translations?: TranslationScope;
}

/** The bundled plugins' ids (ADR-0052), one multi-provider entry per `providePlugin()`. */
export const PLUGIN_IDS = new InjectionToken<readonly string[]>('hexly.plugin.ids');

/** The bundled plugins' {@link TypeDefinition}s, read by the root `TypeRegistry`. */
export const PLUGIN_TYPES = new InjectionToken<readonly TypeDefinition[]>('hexly.plugin.types');

/** The bundled plugins' **Plugin Fields** (ADR-0054), composed into one id→Field resolver by the root `PluginRegistry`. */
export const PLUGIN_FIELDS = new InjectionToken<readonly Field[]>('hexly.plugin.fields');

/** The bundled plugins' {@link ViewDefinition}s, read by the root `ViewRegistry`. */
export const PLUGIN_VIEWS = new InjectionToken<readonly ViewDefinition[]>('hexly.plugin.views');

/**
 * The bundled plugins' {@link StructuredDataType}s, resolved into one set by the root `TypeRegistry`
 * and threaded from there into the domain's `validateFields` / `withFieldDefaults` (ADR-0050) — the
 * domain holds no global registry of its own.
 */
export const PLUGIN_DATA_TYPES = new InjectionToken<readonly StructuredDataType[]>('hexly.plugin.dataTypes');

/**
 * `[typeId, PLUGIN_ID]` tuples the `TypeRegistry` folds into a map to drop a disabled Plugin's Types
 * (ADR-0052, Seam 3) — the web mirror of the server's `BUNDLED_PLUGIN_TYPE_OWNERS`.
 */
export const PLUGIN_TYPE_OWNERS = new InjectionToken<readonly (readonly [string, string])[]>('hexly.plugin.typeOwners');

/** `[viewId, PLUGIN_ID]` tuples the `ViewRegistry` folds into a map to drop a disabled Plugin's Views (ADR-0052, Seam 3). */
export const PLUGIN_VIEW_OWNERS = new InjectionToken<readonly (readonly [ViewId, string])[]>('hexly.plugin.viewOwners');

/**
 * `[fieldId, PLUGIN_ID]` tuples the `PluginRegistry` folds into a map to drop a disabled Plugin's
 * **Fields** (ADR-0052, Seam 3). A Field reached through a Type already degrades when its Type does,
 * but a Field an Entity **attaches directly** (ADR-0054) bypasses the Type layer, so the resolver
 * needs its own by-owner filter to degrade an attached disabled-Plugin Field to a plain document value.
 */
export const PLUGIN_FIELD_OWNERS = new InjectionToken<readonly (readonly [string, string])[]>(
  'hexly.plugin.fieldOwners',
);

/**
 * A bundled plugin's single entry point into the app (ADR-0048): a plugin exports one
 * `providePluginX()` built from this, and the app names it in `app.config.ts`. "Bundled" means
 * compiled-in — there are no runtime third-party plugins — so a plugin joins by shipping a lib and
 * being provided here.
 */
export function providePlugin({
  id,
  types = [],
  fields = [],
  views = [],
  dataTypes = [],
  translations,
}: WebPlugin): EnvironmentProviders {
  return makeEnvironmentProviders([
    { provide: PLUGIN_IDS, useValue: id, multi: true },
    types.map((type) => ({ provide: PLUGIN_TYPES, useValue: type, multi: true })),
    fields.map((field) => ({ provide: PLUGIN_FIELDS, useValue: field, multi: true })),
    views.map((view) => ({ provide: PLUGIN_VIEWS, useValue: view, multi: true })),
    dataTypes.map((dataType) => ({ provide: PLUGIN_DATA_TYPES, useValue: dataType, multi: true })),
    // The ownership tuples the registries filter enablement by (ADR-0052): each contribution's id
    // paired with this Plugin's id, so a disabled Plugin's Types and Views can be dropped by owner.
    types.map((type) => ({ provide: PLUGIN_TYPE_OWNERS, useValue: [type.id, id] as const, multi: true })),
    views.map((view) => ({ provide: PLUGIN_VIEW_OWNERS, useValue: [view.id, id] as const, multi: true })),
    fields.map((field) => ({ provide: PLUGIN_FIELD_OWNERS, useValue: [field.id, id] as const, multi: true })),
    translations ? provideEagerTranslations(translations) : [],
  ]);
}
