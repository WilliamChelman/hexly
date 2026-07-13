import { LinkedEntity, typesSchema } from '@hexly/domain';

/**
 * One end of a link, resolved live off `entities` — an edge never stores a name.
 *
 * `types` arrives already JSON-decoded from the plain JSON column, so it can be malformed or empty.
 * Such a row resolves to `null` and the caller drops it: one unrenderable row must never fail a
 * whole World's read.
 */
export function linkedEntity(id: string, name: string, types: unknown): LinkedEntity | null {
  const parsed = typesSchema.safeParse(types);
  return parsed.success ? { id, name, types: parsed.data } : null;
}
