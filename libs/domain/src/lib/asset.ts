/**
 * The Asset serving URL (ADR-0034): `/assets/<worldId>/<hash>.<ext>`. An
 * unguessable, unauthenticated link — possession of it is the only access control
 * (CONTEXT.md → Asset).
 */

/** Where an Asset's bytes are served from. `ext` carries its own leading dot (`'.png'`). */
export function assetUrl(worldId: string, hash: string, ext: string): string {
  return `/assets/${worldId}/${hash}${ext}`;
}

/**
 * The complete on-disk address of a stored Asset's bytes: content `hash` plus the `ext` pinned at first store
 * (ADR-0034), since the hash alone names no file (#325).
 */
export interface AssetBytesRef {
  readonly hash: string;
  /** The stored extension, carrying its own leading dot (`'.png'`). */
  readonly ext: string;
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
 * The Container and content `hash` an {@link assetUrl} names — everything it takes to reach exactly one
 * Asset, since identical bytes in two Containers share a hash but not an Entity.
 */
export interface AssetUrlRef {
  /** The **Container** whose bytes the URL serves — read off its own path segment. */
  readonly containerId: string;
  /** The content address the bytes are stored under. */
  readonly hash: string;
}

/** A Container segment, then a sha256 digest in lowercase base-16 — the content address an Asset is served under. */
const ASSET_URL = /^\/assets\/([^/]+)\/([0-9a-f]{64})(\.[^/.]+)?$/;

/**
 * The Asset an {@link assetUrl} names, or `null` for anything else — an external `https:` image, a
 * `data:` URI, or a vault-relative `src` not yet rewritten by the import. Those reference no Asset, so
 * they are no edge.
 *
 * The **Container comes from the URL**, never from the referencing Entity's own (ADR-0080): the byte
 * route is unauthenticated and takes the Container from the path, so a document may legitimately carry
 * another Container's URL — and an edge names what the URL names.
 */
export function assetRefFromUrl(src: string): AssetUrlRef | null {
  const match = ASSET_URL.exec(src);
  return match ? { containerId: match[1], hash: match[2] } : null;
}
