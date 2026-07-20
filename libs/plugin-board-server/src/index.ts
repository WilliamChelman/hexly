/**
 * The Board plugin's one entry point into the API (ADR-0053), the server mirror of `providePluginBoard`.
 * Framework-free — it names the `core.type.board` type, the `core.field.surface` Field, and the `core.datatype.board-surface`
 * **Structured Data Type** the API resolves a surface Field against, never the Angular board view. A thin
 * mirror of `serverPluginHexmap`, with one added knob.
 */
import { basePluginConfigSchema, PluginConfigSchema, serverPlugin, ServerPlugin } from '@hexly/domain';
import {
  BOARD_SURFACE_DATA_TYPE,
  CORE_BOARD_TYPE,
  DEFAULT_MAX_EMBED_DEPTH,
  PLUGIN_ID,
  SURFACE_FIELD,
} from '@hexly/plugin-board';
import { z } from 'zod';

/**
 * The Board plugin's `features.plugin.board` schema (ADR-0052, ADR-0062): the base `{ enabled }` plus
 * `maxEmbedDepth`, the ceiling on **Embed** transclusion depth. A positive integer, default 3 — so
 * `features.plugin.board.maxEmbedDepth` is a real Instance-Configuration knob the `-web` half threads
 * into the Entity View Outlet's render context (`EntityRenderContext.maxDepth`), which bounds transclusion.
 */
export const boardConfigSchema: PluginConfigSchema = basePluginConfigSchema.extend({
  maxEmbedDepth: z.number().int().positive().default(DEFAULT_MAX_EMBED_DEPTH),
});

export function serverPluginBoard(): ServerPlugin {
  // Declares the surface Field (ADR-0054); the prose `core.field.content` it references is the content plugin's,
  // folded from there.
  return serverPlugin({
    id: PLUGIN_ID,
    types: [CORE_BOARD_TYPE],
    fields: [SURFACE_FIELD],
    dataTypes: [BOARD_SURFACE_DATA_TYPE],
    configSchema: boardConfigSchema,
  });
}
