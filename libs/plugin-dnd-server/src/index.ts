/**
 * The D&D plugin's one entry point into the API (ADR-0053), the server mirror of `providePluginDnd`.
 * Framework-free by construction — it names only the shared type declaration the API reads for
 * validation and faceting, never the stat-block view (that hangs off `/web`).
 */
import { serverPlugin, ServerPlugin } from '@hexly/domain';
import { PLUGIN_ID, DND_MONSTER_TYPE, DND_STAT_BLOCK_FIELD, STAT_BLOCK_DATA_TYPE } from '@hexly/plugin-dnd';

export function serverPluginDnd(): ServerPlugin {
  // Declares the `dnd.datatype.stat-block` structured Field and its Data Type — the source the API's facet
  // harvest reads its dimensions from (ADR-0055). The prose `core.field.content` it also references is the
  // content plugin's, folded from there.
  return serverPlugin({
    id: PLUGIN_ID,
    types: [DND_MONSTER_TYPE],
    fields: [DND_STAT_BLOCK_FIELD],
    dataTypes: [STAT_BLOCK_DATA_TYPE],
  });
}
