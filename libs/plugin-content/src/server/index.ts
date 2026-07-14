/**
 * The Content plugin's one entry point into the API (ADR-0053), the server mirror of
 * `providePluginContent`. It names `core.note`, the vault-enabled `core.rich-content` data-type (the
 * variant with the Markdown converter the API's vault I/O runs — ADR-0051), and declares `core.note`
 * the default Entity Type for an unstamped import.
 *
 * Pulling the vault variant here means the ~160 kB converter toolchain loads through `/server` — the one
 * public door to it — and never through the framework-free base barrel or `/web`.
 */
import { serverPlugin, ServerPlugin } from '@hexly/domain';
import { PLUGIN_ID } from '../lib/plugin-id';
import { CORE_NOTE_TYPE } from '../lib/note-type';
import { RICH_CONTENT_DATA_TYPE_VAULT } from '../lib/rich-content-vault';

export function serverPluginContent(): ServerPlugin {
  return serverPlugin({
    id: PLUGIN_ID,
    types: [CORE_NOTE_TYPE],
    dataTypes: [RICH_CONTENT_DATA_TYPE_VAULT],
    defaultType: CORE_NOTE_TYPE.id,
  });
}
