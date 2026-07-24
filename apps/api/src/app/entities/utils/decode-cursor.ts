/**
 * Decode opaque list cursor (ADR-0025) to server-internal offset.
 * Malformed cursor returns null, converted to 400 by controller (ADR-0001).
 */
export function decodeCursor(cursor: string): number | null {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  // base64url is lenient; guard decoded payload, not encoding.
  if (!/^\d+$/.test(decoded)) return null;
  const offset = Number(decoded);
  return Number.isSafeInteger(offset) ? offset : null;
}
