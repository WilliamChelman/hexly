/**
 * Encode a server-internal offset as an opaque list cursor (ADR-0025): clients must treat the
 * result as a black box.
 */
export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url');
}
