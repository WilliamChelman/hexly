import { PluginTypeDefinition, structuredDataTypeSet, StructuredDataTypeSet } from '@hexly/domain';
import { DND_MONSTER_TYPE } from '@hexly/plugin-dnd';
import { CORE_HEXMAP_TYPE, HEX_GRID_DATA_TYPE } from '@hexly/plugin-hexmap';

/**
 * Which plugins this build bundles, API side (ADR-0048). "Bundled" means compiled-in — a plugin
 * joins by shipping a lib and being named here. Only a plugin's framework-free half is imported:
 * its id, label, and Field schema, never its view.
 */
export const BUNDLED_PLUGIN_TYPES: readonly PluginTypeDefinition[] = [CORE_HEXMAP_TYPE, DND_MONSTER_TYPE];

/**
 * The **Structured Field** data-types this build bundles (ADR-0050): the set the domain resolves a
 * Field's `namespace.id` kind against, threaded into `validateFields` / `harvestEdges` /
 * `withFieldDefaults`. One joins by being named here, as a plugin type does above.
 */
export const BUNDLED_STRUCTURED_DATA_TYPES: StructuredDataTypeSet = structuredDataTypeSet([HEX_GRID_DATA_TYPE]);
