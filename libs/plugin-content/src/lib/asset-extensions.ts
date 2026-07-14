/**
 * The media extensions an `![[target]]` embeds as an Asset rather than a note transclusion (ADR-0033).
 *
 * A standalone module — not a member of the Markdown converter — precisely because it is a light
 * constant the barrel can re-export to the API (whose asset MIME map must cover every extension here)
 * without dragging the converter's `unified`/`remark` toolchain onto whoever imports the barrel. The
 * converter itself reads {@link ASSET_EMBED_EXT} from here (ADR-0051).
 */

/** Extensions Obsidian embeds as media; anything else in an `![[…]]` stays a degraded link. */
export const ASSET_EMBED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'pdf'];

/** The extension test derived from {@link ASSET_EMBED_EXTENSIONS}. */
export const ASSET_EMBED_EXT = new RegExp(`\\.(${ASSET_EMBED_EXTENSIONS.join('|')})$`, 'i');
