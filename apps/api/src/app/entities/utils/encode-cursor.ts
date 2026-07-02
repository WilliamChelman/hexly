/**
 * Encode server-internal offset as opaque list cursor (ADR-0025).
 * Clients treat as black box; encoding can evolve to keyset/ranking cursor.
 */
export function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64url');
}
