/**
 * The Hex Map plugin's one entry point into the API (ADR-0053), the server mirror of
 * `providePluginHexmap`. Framework-free — it names the `core.type.hex-map` type and the `core.datatype.hex-grid`
 * **Structured Data Type** the API resolves a grid Field against, never the Angular map view.
 */
import { serverPlugin, ServerPlugin } from '@hexly/domain';
import { PLUGIN_ID, CORE_HEXMAP_TYPE, HEX_GRID_DATA_TYPE, HEX_GRID_FIELD } from '@hexly/plugin-hexmap';

export function serverPluginHexmap(): ServerPlugin {
  // Declares the grid Field (ADR-0054); the prose `core.field.content` it references is the content plugin's,
  // folded from there.
  return serverPlugin({
    id: PLUGIN_ID,
    types: [CORE_HEXMAP_TYPE],
    fields: [HEX_GRID_FIELD],
    dataTypes: [HEX_GRID_DATA_TYPE],
  });
}
