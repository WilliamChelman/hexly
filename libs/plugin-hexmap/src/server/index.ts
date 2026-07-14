/**
 * The Hex Map plugin's one entry point into the API (ADR-0053), the server mirror of
 * `providePluginHexmap`. Framework-free — it names the `core.hexmap` type and the `core.hex-grid`
 * **Structured Field** data-type the API resolves a grid Field against, never the Angular map view.
 */
import { serverPlugin, ServerPlugin } from '@hexly/domain';
import { CORE_HEXMAP_TYPE } from '../lib/hexmap-type';
import { HEX_GRID_DATA_TYPE } from '../lib/hex-grid';

export function serverPluginHexmap(): ServerPlugin {
  return serverPlugin({ types: [CORE_HEXMAP_TYPE], dataTypes: [HEX_GRID_DATA_TYPE] });
}
