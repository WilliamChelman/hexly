/**
 * Decode an opaque list cursor (ADR-0025) back to its server-internal offset.
 * Total: a string that is not a well-formed cursor returns `null`, which the
 * controller turns into a 400 (ADR-0001) rather than a 500 deeper down.
 */
export function decodeCursor(cursor: string): number | null {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  // base64url is lenient, so guard the decoded payload, not just the encoding.
  if (!/^\d+$/.test(decoded)) return null;
  const offset = Number(decoded);
  return Number.isSafeInteger(offset) ? offset : null;
}
