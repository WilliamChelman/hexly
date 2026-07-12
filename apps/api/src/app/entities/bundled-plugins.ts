import {
  CORE_STRUCTURED_DATA_TYPES,
  PluginTypeDefinition,
  structuredDataTypeSet,
  StructuredDataTypeSet,
} from '@hexly/domain';
import { DND_MONSTER_TYPE } from '@hexly/plugin-dnd';

/**
 * Which plugins this build bundles, API side (ADR-0048, #192) — the twin of the web's list. "Bundled"
 * means compiled-in (the ADR rules out runtime third-party plugins), so a plugin joins by shipping a
 * lib and being named here.
 *
 * Only a plugin's framework-free half is imported: its id, label, and Field schema. The API validates
 * and facets a monster without importing its view.
 */
export const BUNDLED_PLUGIN_TYPES: readonly PluginTypeDefinition[] = [DND_MONSTER_TYPE];

/**
 * The **Structured Field** data-types this build bundles (ADR-0050) — the set the domain resolves a
 * Field's `namespace.id` kind against, threaded into `validateFields` / `harvestEdges` /
 * `withFieldDefaults`. The core's own (`core.hex-grid`, the Hex Map's grid) plus, in time, each
 * bundled plugin's: one joins by being named here, as a plugin type does above.
 */
export const BUNDLED_STRUCTURED_DATA_TYPES: StructuredDataTypeSet = structuredDataTypeSet([
  ...CORE_STRUCTURED_DATA_TYPES,
]);
