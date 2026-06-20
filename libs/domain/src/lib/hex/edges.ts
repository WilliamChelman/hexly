import { Axial, neighbors } from './coordinates';

/** Stable string key for a hex coordinate. */
function hexKey({ q, r }: Axial): string {
  return `${q},${r}`;
}

/**
 * Canonical identity for the edge on a hex's given side (`direction` 0–5, in the
 * `neighbors` order). An edge is shared by exactly two hexes; the id is the
 * unordered pair of their coordinates, so both hexes name the *same* edge. This
 * is the join an edge-riding Overlay (river, road, border) is keyed on.
 */
export function edgeId(hex: Axial, direction: number): string {
  const other = neighbors(hex)[direction];
  return [hexKey(hex), hexKey(other)].sort().join('|');
}

/**
 * Canonical identity for the vertex at a hex's given corner (`corner` 0–5). A
 * vertex is where three hexes meet — the hex plus the two neighbours flanking
 * that corner — so the id is the unordered triple of their coordinates, agreed
 * on by all three. The join a vertex-riding Overlay is keyed on.
 */
export function vertexId(hex: Axial, corner: number): string {
  const ns = neighbors(hex);
  const flanks = [ns[corner], ns[(corner + 1) % 6]];
  return [hexKey(hex), ...flanks.map(hexKey)].sort().join('|');
}
