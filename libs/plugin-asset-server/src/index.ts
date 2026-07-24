/**
 * The Asset plugin's one entry point into the API (ADR-0053, ADR-0065), the server mirror of
 * `providePluginAsset`. Framework-free — it names the `core.type.asset` type, the `core.field.asset` asset-ref
 * Field, and the `core.datatype.asset` **Structured Data Type** the API resolves an asset-ref against (whose
 * content hash the write choke point mirrors to the dedup index), never the Angular asset view.
 *
 * The prose `core.field.content` the type also references is the content plugin's, folded from there.
 */
import { serverPlugin, ServerPlugin } from '@hexly/domain';
import { ASSET_DATA_TYPE, ASSET_FIELD, CORE_ASSET_TYPE, PLUGIN_ID, THUMBNAIL_FIELD } from '@hexly/plugin-asset';

export function serverPluginAsset(): ServerPlugin {
  return serverPlugin({
    id: PLUGIN_ID,
    types: [CORE_ASSET_TYPE],
    // The asset-ref Field `core.type.asset` defaults, plus the canonical Thumbnail Field (ADR-0066) — a
    // reusable Field no Type defaults, registered so it resolves as an attach-on-demand extra (ADR-0054/0057).
    fields: [ASSET_FIELD, THUMBNAIL_FIELD],
    dataTypes: [ASSET_DATA_TYPE],
  });
}
