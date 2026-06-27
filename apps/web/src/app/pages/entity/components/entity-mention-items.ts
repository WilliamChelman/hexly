import { EntitySummary } from '@hexly/domain';

/**
 * Narrow the owner's Entity summaries by the `@`-picker query — a client-side
 * substring match on name, case-insensitive (issue #95, ADR-0023). Deliberately
 * unfiltered by type or self: notes, hexmaps, and the current Entity are all
 * valid link targets. Empty query → every entity.
 */
export function filterEntities(entities: EntitySummary[], query: string): EntitySummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return entities;
  return entities.filter((e) => e.name.toLowerCase().includes(q));
}
