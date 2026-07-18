/**
 * The Draw Steel plugin's one entry point into the API (ADR-0053), the server mirror of
 * `providePluginDrawSteel`. Framework-free by construction — it names only the shared type declaration
 * the API reads for validation, never the stat-block view (that hangs off `/web`).
 */
import { serverPlugin, ServerPlugin } from '@hexly/domain';
import { PLUGIN_ID, DS_MONSTER_TYPE, DS_STAT_BLOCK_FIELD, STAT_BLOCK_DATA_TYPE } from '@hexly/plugin-draw-steel';

export function serverPluginDrawSteel(): ServerPlugin {
  // Declares the `draw-steel.stat-block` structured Field and its Data Type — the source the API's
  // forward-only gate resolves a Monster's block against (ADR-0050/0055). The prose `core.content` it also
  // references is the content plugin's, folded from there.
  return serverPlugin({
    id: PLUGIN_ID,
    types: [DS_MONSTER_TYPE],
    fields: [DS_STAT_BLOCK_FIELD],
    dataTypes: [STAT_BLOCK_DATA_TYPE],
  });
}
