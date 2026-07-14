import {
  basePluginConfigSchema,
  EntityType,
  ServerPlugin,
  structuredDataTypeSet,
  StructuredDataTypeSet,
} from '@hexly/domain';
import { PluginConfigContribution } from '../config/config';
import { serverPluginContent } from '@hexly/plugin-content/server';
import { serverPluginDnd } from '@hexly/plugin-dnd/server';
import { serverPluginHexmap } from '@hexly/plugin-hexmap/server';

/**
 * Which plugins this build bundles, API side (ADR-0048, ADR-0051, ADR-0053). "Bundled" means
 * compiled-in — a plugin joins by shipping a lib and being named here. Each plugin states its own
 * server contribution once, behind a single `serverPluginX()` entry point (the mirror of the web's
 * `providePluginX()`); this composition root folds the list rather than reaching into each plugin's
 * individual exports.
 */
const BUNDLED_PLUGINS: readonly ServerPlugin[] = [serverPluginContent(), serverPluginHexmap(), serverPluginDnd()];

/**
 * The bundled plugins' Type declarations — only their framework-free half: id, label, and Field
 * schema, never a view. `core.note` is a bundled type like any other now — the domain declares no
 * Entity Type (ADR-0051).
 */
export const BUNDLED_PLUGIN_TYPES = BUNDLED_PLUGINS.flatMap((plugin) => plugin.types ?? []);

/**
 * The **Structured Field** data-types this build bundles (ADR-0050, ADR-0051): the set the domain
 * resolves a Field's `namespace.id` kind against, threaded into `validateFields` / `harvestEdges` /
 * `deriveSearchText` / `withFieldDefaults`. `core.rich-content` — prose — is one of them now, so the
 * derive pass has no Content special case left. The plugins supply the vault-enabled variants, since
 * the API resolves both the derive pass and the vault projection off this set (ADR-0051).
 */
export const BUNDLED_STRUCTURED_DATA_TYPES: StructuredDataTypeSet = structuredDataTypeSet(
  BUNDLED_PLUGINS.flatMap((plugin) => plugin.dataTypes ?? []),
);

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

/** Which bundled Plugin owns each **Structured Field** data-type, keyed by its `namespace.id` kind (ADR-0052). */
export const BUNDLED_STRUCTURED_DATA_TYPE_OWNERS: ReadonlyMap<string, string> = new Map(
  BUNDLED_PLUGINS.flatMap((plugin) => (plugin.dataTypes ?? []).map((dataType) => [dataType.id, plugin.id] as const)),
);

/**
 * The Entity Type a vault import assigns a Markdown file with no `hexly.type` stamp, and the one whose
 * lone presence marks an Entity a "bare Note" the export leaves unstamped (ADR-0051). Exactly one
 * bundled plugin declares it (content → `core.note`), so the vault services need not import
 * `@hexly/plugin-content` to learn the default.
 */
export const DEFAULT_ENTITY_TYPE: EntityType = defaultEntityType();

function defaultEntityType(): EntityType {
  const declared = BUNDLED_PLUGINS.map((plugin) => plugin.defaultType).filter((type): type is EntityType => !!type);
  if (declared.length !== 1) {
    throw new Error(`Expected exactly one bundled plugin to declare a default Entity Type, found ${declared.length}`);
  }
  return declared[0];
}
