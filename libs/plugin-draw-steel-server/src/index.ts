/**
 * The Draw Steel plugin's one entry point into the API (ADR-0053), the server mirror of
 * `providePluginDrawSteel`. Framework-free by construction — it names the shared type declaration the API
 * reads for validation and contributes the `draw-steel.monsters` **Importer** (ADR-0060), never the
 * stat-block view (that hangs off `/web`).
 */
import { serverPlugin, ServerPlugin } from '@hexly/domain';
import { PLUGIN_ID, DS_MONSTER_TYPE, DS_STAT_BLOCK_FIELD, STAT_BLOCK_DATA_TYPE } from '@hexly/plugin-draw-steel';
import { createMonstersImporter } from './lib/monsters-importer';
import { githubTarballFetchPort } from './lib/monster-fetch-port';

export * from './lib/monster-fetch-port';
export * from './lib/monsters-importer';

export function serverPluginDrawSteel(): ServerPlugin {
  // Declares the `draw-steel.stat-block` structured Field and its Data Type — the source the API's
  // forward-only gate resolves a Monster's block against (ADR-0050/0055). The prose `core.content` it also
  // references is the content plugin's, folded from there. Contributes the `draw-steel.monsters` Importer
  // over the real codeload-tarball fetch port (ADR-0060/0061); a test overrides it with a fixture port.
  return serverPlugin({
    id: PLUGIN_ID,
    types: [DS_MONSTER_TYPE],
    fields: [DS_STAT_BLOCK_FIELD],
    dataTypes: [STAT_BLOCK_DATA_TYPE],
    importers: [createMonstersImporter(githubTarballFetchPort())],
  });
}
