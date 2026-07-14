/**
 * The D&D plugin's one entry point into the API (ADR-0053), the server mirror of `providePluginDnd`.
 * Framework-free by construction — it names only the shared type declaration the API reads for
 * validation and faceting, never the stat-block view (that hangs off `/web`).
 */
import { serverPlugin, ServerPlugin } from '@hexly/domain';
import { PLUGIN_ID } from '../lib/plugin-id';
import { DND_MONSTER_TYPE } from '../lib/monster';

export function serverPluginDnd(): ServerPlugin {
  return serverPlugin({ id: PLUGIN_ID, types: [DND_MONSTER_TYPE] });
}
