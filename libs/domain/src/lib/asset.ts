/**
 * The Asset serving URL (ADR-0034): `/assets/<worldId>/<hash>.<ext>`. An
 * unguessable, unauthenticated link — possession of it is the only access control
 * (CONTEXT.md → Asset).
 */

/** Where an Asset's bytes are served from. `ext` carries its own leading dot (`'.png'`). */
export function assetUrl(worldId: string, hash: string, ext: string): string {
  return `/assets/${worldId}/${hash}${ext}`;
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
