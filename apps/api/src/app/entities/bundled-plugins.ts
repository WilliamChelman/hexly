import {
  basePluginConfigSchema,
  EntityType,
  Field,
  Importer,
  PluginTypeDefinition,
  ServerPlugin,
  structuredDataTypeSet,
  StructuredDataTypeSet,
} from '@hexly/domain';
import { HexlyConfig, PluginConfigContribution } from '../config';
import { serverPluginAsset } from '@hexly/plugin-asset/server';
import { serverPluginBoard } from '@hexly/plugin-board/server';
import { serverPluginContent } from '@hexly/plugin-content/server';
import { serverPluginDnd } from '@hexly/plugin-dnd/server';
import { serverPluginDrawSteel } from '@hexly/plugin-draw-steel/server';
import { serverPluginHexmap } from '@hexly/plugin-hexmap/server';

/**
 * Which plugins this build bundles, API side (ADR-0048, ADR-0051, ADR-0053). "Bundled" means
 * compiled-in — a plugin joins by shipping a lib and being named here. Each plugin states its own
 * server contribution once, behind a single `serverPluginX()` entry point (the mirror of the web's
 * `providePluginX()`); this composition root folds the list rather than reaching into each plugin's
 * individual exports.
 */
const BUNDLED_PLUGINS: readonly ServerPlugin[] = [
  serverPluginContent(),
  serverPluginHexmap(),
  serverPluginBoard(),
  serverPluginAsset(),
  serverPluginDnd(),
  serverPluginDrawSteel(),
];

/** Whether the Plugin owning `pluginId` is enabled (ADR-0052); absent from `features.plugin` → enabled. */
function pluginEnabled(config: HexlyConfig, pluginId: string): boolean {
  return config.features.plugin[pluginId]?.enabled ?? true;
}

/** The bundled Plugins this Instance enables — the set every derived contribution filters through (ADR-0052). */
function enabledPlugins(config: HexlyConfig): readonly ServerPlugin[] {
  return BUNDLED_PLUGINS.filter((plugin) => pluginEnabled(config, plugin.id));
}

/**
 * The enabled bundled Plugins' Type declarations — framework-free half only (id, label, Field schema),
 * never a view. `core.type.note` is a bundled type like any other, so a disabled content Plugin drops it
 * (ADR-0051, ADR-0052). Seeds {@link TypeFieldRegistry}.
 */
export function enabledPluginTypes(config: HexlyConfig): readonly PluginTypeDefinition[] {
  return enabledPlugins(config).flatMap((plugin) => plugin.types ?? []);
}

/**
 * The enabled bundled Plugins' code-registered **Fields** (`defineField`, ADR-0054), folded into the
 * id→Field resolver like the type and data-type sets. A disabled Plugin's Fields are absent, so a
 * reference to one degrades to a plain **Entity Document** value (ADR-0052).
 */
export function enabledPluginFields(config: HexlyConfig): readonly Field[] {
  return enabledPlugins(config).flatMap((plugin) => plugin.fields ?? []);
}

/**
 * The enabled bundled Plugins' contributed **Importer**s (ADR-0060), folded from the same list like the
 * type and Field sets. A disabled Plugin's Importers are absent, so its Imports-panel entry and reconcile
 * path drop with it (ADR-0052). The generic Imports panel and reconcile serve whatever this returns.
 */
export function enabledPluginImporters(config: HexlyConfig): readonly Importer[] {
  return enabledPlugins(config).flatMap((plugin) => plugin.importers ?? []);
}

/**
 * The enabled **Structured Data Types** (ADR-0050, ADR-0052): the set the derive and vault passes
 * resolve a Field's `namespace.id` kind against. A disabled Plugin's data-types are absent, leaving its
 * **Fields of a Structured Data Type** as opaque **Entity Document** values.
 */
export function enabledStructuredDataTypes(config: HexlyConfig): StructuredDataTypeSet {
  return structuredDataTypesOf(enabledPlugins(config));
}

/**
 * Every bundled **Structured Data Type**, regardless of enablement (ADR-0052) — the register-time
 * guard that a bundled Type names only data-types the build ships. Unlike {@link enabledStructuredDataTypes},
 * it tolerates a Type naming a disabled Plugin's data-type (`core.type.hex-map`'s `content` Field when content
 * is off): that degrades at derive/vault time; a kind no Plugin bundles is still a build error.
 */
export const BUNDLED_STRUCTURED_DATA_TYPES: StructuredDataTypeSet = structuredDataTypesOf(BUNDLED_PLUGINS);

/** Fold a plugin set's contributed **Structured Data Types** into one resolved set (ADR-0050). */
function structuredDataTypesOf(plugins: readonly ServerPlugin[]): StructuredDataTypeSet {
  return structuredDataTypeSet(plugins.flatMap((plugin) => plugin.dataTypes ?? []));
}

/**
 * Each bundled Plugin's `features.plugin.<id>` config contribution (ADR-0052): its id and config
 * schema, folded from the same `BUNDLED_PLUGINS` list. `config.ts` merges these to compose
 * `features.plugin` — adding a new bundled Plugin makes it toggleable with no `config.ts` edit.
 */
export const BUNDLED_PLUGIN_CONFIGS: readonly PluginConfigContribution[] = BUNDLED_PLUGINS.map((plugin) => ({
  id: plugin.id,
  configSchema: plugin.configSchema ?? basePluginConfigSchema,
}));

/** Which bundled Plugin owns each contributed Entity Type, keyed by Type id (ADR-0052). */
export const BUNDLED_PLUGIN_TYPE_OWNERS: ReadonlyMap<string, string> = new Map(
  BUNDLED_PLUGINS.flatMap((plugin) => (plugin.types ?? []).map((type) => [type.id, plugin.id] as const)),
);

/** Which bundled Plugin owns each **Structured Data Type**, keyed by its `namespace.id` kind (ADR-0052). */
export const BUNDLED_STRUCTURED_DATA_TYPE_OWNERS: ReadonlyMap<string, string> = new Map(
  BUNDLED_PLUGINS.flatMap((plugin) => (plugin.dataTypes ?? []).map((dataType) => [dataType.id, plugin.id] as const)),
);

/**
 * The Entity Type a vault import assigns a Markdown file with no `hexly.type` stamp, and the one whose
 * lone presence marks an Entity a "bare Note" the export leaves unstamped (ADR-0051, ADR-0052). Exactly
 * one bundled plugin declares it (content → `core.type.note`), so the vault services need not import
 * `@hexly/plugin-content` to learn the default.
 *
 * Relaxed since content became disableable (ADR-0052): with no enabled Plugin declaring a default it
 * returns `undefined` rather than throwing, and the vault services then stamp every Entity's types.
 * More than one enabled declarer is still a build error.
 */
export function defaultEntityType(config: HexlyConfig): EntityType | undefined {
  const declared = enabledPlugins(config)
    .map((plugin) => plugin.defaultType)
    .filter((type): type is EntityType => !!type);
  if (declared.length > 1) {
    throw new Error(
      `Expected at most one enabled bundled plugin to declare a default Entity Type, found ${declared.length}`,
    );
  }
  return declared[0];
}
