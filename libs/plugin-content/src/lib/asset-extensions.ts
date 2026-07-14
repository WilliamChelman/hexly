/**
 * The media extensions an `![[target]]` embeds as an Asset rather than a note transclusion. A standalone
 * module, not part of the converter, so the barrel can re-export this light constant to the API (whose
 * asset MIME map must cover every extension here) without the converter's toolchain (ADR-0033, ADR-0051).
 */

/** Extensions Obsidian embeds as media; anything else in an `![[…]]` stays a degraded link. */
export const ASSET_EMBED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'pdf'];

/** The extension test derived from {@link ASSET_EMBED_EXTENSIONS}. */
export const ASSET_EMBED_EXT = new RegExp(`\\.(${ASSET_EMBED_EXTENSIONS.join('|')})$`, 'i');
