/** The Board plugin's canonical id (ADR-0052, #263). */
export const PLUGIN_ID = 'board';

/**
 * The Instance-configurable ceiling on Embed transclusion depth (ADR-0062, `features.plugin.board.maxEmbedDepth`).
 * Stated once here so the server's config-schema default and any depth-bounding caller share the number.
 */
export const DEFAULT_MAX_EMBED_DEPTH = 3;
