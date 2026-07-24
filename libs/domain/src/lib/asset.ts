/**
 * The Asset serving URL (ADR-0034): `/assets/<worldId>/<hash>.<ext>`. An
 * unguessable, unauthenticated link — possession of it is the only access control
 * (CONTEXT.md → Asset).
 */

import * as z from 'zod';

/** Where an Asset's bytes are served from. `ext` carries its own leading dot (`'.png'`). */
export function assetUrl(worldId: string, hash: string, ext: string): string {
  return `/assets/${worldId}/${hash}${ext}`;
}

/**
 * The suffix a thumbnail is stored and served under, beside its source at a hash-derived path (ADR-0065).
 * A thumbnail is a regenerable cache — no row, no identity — so its path is derived from the source hash,
 * never stored; the serving route falls back to the original bytes when the thumb is absent.
 */
export const THUMBNAIL_SUFFIX = '.thumb.webp';

/**
 * Where an Asset's ~400px WebP thumbnail is served from (ADR-0065): the same unauthenticated route as the
 * bytes, at the hash-derived {@link THUMBNAIL_SUFFIX} path. Requesting it is always safe — the route serves
 * the thumbnail when it exists and falls back to the original bytes when it does not (a non-image, or an
 * upload sharp could not parse).
 */
export function assetThumbnailUrl(worldId: string, hash: string): string {
  return `/assets/${worldId}/${hash}${THUMBNAIL_SUFFIX}`;
}

/**
 * A stored World Asset as the browser sees it: the served capability {@link assetUrl} an author
 * references (from Content, or a Board Image element — #269), plus the metadata a picker shows. The
 * `url` is the only load-bearing field a reference stores; the rest label the row in a chooser.
 */
export interface AssetSummary {
  /** The served capability URL — the string an Image element or Content `src` holds. */
  readonly url: string;
  /**
   * The served thumbnail URL (ADR-0065) — the lightweight image a grid renders so it never downloads raw
   * bytes. Falls back to the original on the serving route when no thumbnail was minted, so it is always
   * safe to use as a tile `src`; a reference still stores {@link url}, the full-resolution capability URL.
   */
  readonly thumbnailUrl: string;
  /** The human-readable name the Asset was uploaded/imported under, for display in a picker. */
  readonly originalFilename: string;
  /** The Asset's content type (`image/png`, `application/pdf`, …). */
  readonly mime: string;
  /** The Asset's size in bytes. */
  readonly size: number;
}

/**
 * The Board image picker's search query (#281, ADR-0065): the subset of the Entity list contract the
 * picker speaks against `GET /worlds/:id/assets(/facets)` — an FTS `q` and repeated `field` facet tokens
 * (`orientation:eq:landscape`). The server pins the asset type + image kind on top, so these are only the
 * caller-controlled axes. `field` normalises the query-string's one-or-many shape to an array, matching
 * the Entity list schema so the two search surfaces stay one contract.
 */
export const assetSearchQuerySchema = z.object({
  q: z.string().optional(),
  field: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
});

export type AssetSearchQuery = z.infer<typeof assetSearchQuerySchema>;

/** A sha256 digest, lowercase base-16 — the content address an Asset is stored and served under. */
const ASSET_URL = /^\/assets\/[^/]+\/([0-9a-f]{64})(\.[^/.]+)?$/;

/**
 * The Asset `hash` an {@link assetUrl} names, or `null` for anything else — an
 * external `https:` image, a `data:` URI, or a vault-relative `src` not yet
 * rewritten by the import. Those reference no Asset, so they are no edge.
 */
export function assetHashFromUrl(src: string): string | null {
  return ASSET_URL.exec(src)?.[1] ?? null;
}
