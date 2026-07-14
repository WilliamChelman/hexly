import { EntityType, PluginTypeDefinition, structuredDataTypeSet, StructuredDataTypeSet } from '@hexly/domain';
import { CORE_NOTE_TYPE } from '@hexly/plugin-content';
import { RICH_CONTENT_DATA_TYPE_VAULT } from '@hexly/plugin-content/vault';
import { DND_MONSTER_TYPE } from '@hexly/plugin-dnd';
import { CORE_HEXMAP_TYPE, HEX_GRID_DATA_TYPE } from '@hexly/plugin-hexmap';

/**
 * Which plugins this build bundles, API side (ADR-0048, ADR-0051). "Bundled" means compiled-in — a
 * plugin joins by shipping a lib and being named here. Only a plugin's framework-free half is
 * imported: its id, label, and Field schema, never its view. `core.note` is a bundled type like any
 * other now — the domain declares no Entity Type (ADR-0051).
 */
export const BUNDLED_PLUGIN_TYPES: readonly PluginTypeDefinition[] = [
  CORE_NOTE_TYPE,
  CORE_HEXMAP_TYPE,
  DND_MONSTER_TYPE,
];

/**
 * The **Structured Field** data-types this build bundles (ADR-0050, ADR-0051): the set the domain
 * resolves a Field's `namespace.id` kind against, threaded into `validateFields` / `harvestEdges` /
 * `deriveSearchText` / `withFieldDefaults`. `core.rich-content` — prose — is one of them now, so the
 * derive pass has no Content special case left. One joins by being named here, as a plugin type does.
 */
export const BUNDLED_STRUCTURED_DATA_TYPES: StructuredDataTypeSet = structuredDataTypeSet([
  // The vault-enabled variant — the API resolves both the derive pass (edges/text) and the vault
  // import/export projection off this set, and vault I/O needs the Markdown converter (ADR-0051). The
  // web registers the converter-free `RICH_CONTENT_DATA_TYPE` instead, so the toolchain stays server-side.
  RICH_CONTENT_DATA_TYPE_VAULT,
  HEX_GRID_DATA_TYPE,
]);

/**
 * The Entity Type a vault import assigns a Markdown file with no `hexly.type` stamp, and the one whose
 * lone presence marks an Entity a "bare Note" the export leaves unstamped (ADR-0051). Named here — the
 * composition root that already knows the bundled plugins — so the vault services need not import
 * `@hexly/plugin-content` to learn which type is the default (`core.note`).
 */
export const DEFAULT_ENTITY_TYPE: EntityType = CORE_NOTE_TYPE.id;
