import { LinkedEntity, typesSchema } from '@hexly/domain';

/**
 * One end of a link, resolved live off `entities` — an edge never stores a name.
 *
 * `types` arrives already JSON-decoded from the plain JSON column, so it can be malformed or empty.
 * Such a row resolves to `null` and the caller drops it: one unrenderable row must never fail a
 * whole World's read.
 */
export function linkedEntity(id: string, name: string, types: unknown, thumbnailUrl?: string): LinkedEntity | null {
  const parsed = typesSchema.safeParse(types);
  if (!parsed.success) return null;
  // Omit the key entirely when unresolved, so a row without a thumbnail serialises identically to before.
  return thumbnailUrl ? { id, name, types: parsed.data, thumbnailUrl } : { id, name, types: parsed.data };
}
