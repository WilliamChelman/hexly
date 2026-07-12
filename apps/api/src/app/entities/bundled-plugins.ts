import { PluginTypeDefinition, structuredDataTypeSet, StructuredDataTypeSet } from '@hexly/domain';
import { DND_MONSTER_TYPE } from '@hexly/plugin-dnd';
import { CORE_HEXMAP_TYPE, HEX_GRID_DATA_TYPE } from '@hexly/plugin-hexmap';

/**
 * Which plugins this build bundles, API side (ADR-0048, #192) — the twin of the web's list. "Bundled"
 * means compiled-in (the ADR rules out runtime third-party plugins), so a plugin joins by shipping a
 * lib and being named here. The Hex Map is one of them (ADR-0050): `core.hexmap` reaches the API the
 * same way `dnd.monster` does, and nothing in `apps/api` knows what a hex is.
 *
 * Only a plugin's framework-free half is imported: its id, label, and Field schema. The API validates
 * and facets a monster — and a Hex Map — without importing either one's view.
 */
export const BUNDLED_PLUGIN_TYPES: readonly PluginTypeDefinition[] = [CORE_HEXMAP_TYPE, DND_MONSTER_TYPE];

/**
 * The **Structured Field** data-types this build bundles (ADR-0050) — the set the domain resolves a
 * Field's `namespace.id` kind against, threaded into `validateFields` / `harvestEdges` /
 * `withFieldDefaults`. One today: the Hex Map's grid (`core.hex-grid`), whose schema validates a grid
 * on the way in and whose harvester turns its placements into link edges. One joins by being named
 * here, as a plugin type does above.
 */
export const BUNDLED_STRUCTURED_DATA_TYPES: StructuredDataTypeSet = structuredDataTypeSet([HEX_GRID_DATA_TYPE]);
