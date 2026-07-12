import { PluginTypeDefinition, structuredDataTypeSet, StructuredDataTypeSet } from '@hexly/domain';
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
 * The **Structured Field** data-types this build bundles (ADR-0050) — the composition root the domain
 * resolves a `namespace.id` kind against, threaded in rather than reached for. Empty until a plugin
 * contributes one: `core.hex-grid` arrives with `@hexly/plugin-hexmap`, and joins by being named here.
 *
 * A Field naming a kind this set does not carry is rejected where its Type is declared, and its value
 * is inert everywhere else — so an operator dropping a plugin from the build degrades, never corrupts.
 */
export const BUNDLED_STRUCTURED_DATA_TYPES: StructuredDataTypeSet = structuredDataTypeSet([]);
