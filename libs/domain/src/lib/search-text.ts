/**
 * Join the pieces a searchable-text contributor yields into one single-spaced line (ADR-0035).
 * Contributors space themselves inconsistently — a prose node brings its own, a Hex name none — so
 * runs are collapsed, and an absent piece (an unnamed Hex) drops out rather than padding the result.
 */
export function joinSearchText(parts: readonly (string | undefined)[]): string {
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
