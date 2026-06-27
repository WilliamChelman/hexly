/**
 * Encode a server-internal offset as the opaque list cursor (ADR-0025). Clients
 * treat the result as a black box and only echo it back as `cursor`, so the
 * encoding can switch from today's trivial offset to a keyset/ranking cursor
 * with no consumer change.
 */
export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url');
}
