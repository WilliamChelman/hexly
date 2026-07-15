/**
 * The Hex Map plugin's one entry point into the API (ADR-0053), the server mirror of
 * `providePluginHexmap`. Framework-free — it names the `core.hexmap` type and the `core.hex-grid`
 * **Structured Data Type** the API resolves a grid Field against, never the Angular map view.
 */
import { serverPlugin, ServerPlugin } from '@hexly/domain';
import { PLUGIN_ID } from '../lib/plugin-id';
import { CORE_HEXMAP_TYPE } from '../lib/hexmap-type';
import { HEX_GRID_DATA_TYPE, HEX_GRID_FIELD } from '../lib/hex-grid';

export function serverPluginHexmap(): ServerPlugin {
  // Declares the grid Field (ADR-0054); the prose `core.content` it references is the content plugin's,
  // folded from there.
  return serverPlugin({
    id: PLUGIN_ID,
    types: [CORE_HEXMAP_TYPE],
    fields: [HEX_GRID_FIELD],
    dataTypes: [HEX_GRID_DATA_TYPE],
  });
}
