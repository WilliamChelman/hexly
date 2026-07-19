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
 * A stored World Asset as the browser sees it: the served capability {@link assetUrl} an author
 * references (from Content, or a Board Image element — #269), plus the metadata a picker shows. The
 * `url` is the only load-bearing field a reference stores; the rest label the row in a chooser.
 */
export interface AssetSummary {
  /** The served capability URL — the string an Image element or Content `src` holds. */
  readonly url: string;
  /** The human-readable name the Asset was uploaded/imported under, for display in a picker. */
  readonly originalFilename: string;
  /** The Asset's content type (`image/png`, `application/pdf`, …). */
  readonly mime: string;
  /** The Asset's size in bytes. */
  readonly size: number;
}

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
