import { LinkedEntity, typesSchema } from '@hexly/domain';

/**
 * One end of a link, resolved live off `entities` — an edge never stores a name.
 *
 * `entities.types` is a plain JSON column, so a row can hold a malformed or empty set: a corrupt
 * row, or one this build cannot make sense of. Such an Entity has no shape any of these surfaces can
 * draw, so it resolves to `null` and the caller drops it — one unrenderable row must never fail a
 * whole World's read. `types` arrives already JSON-decoded from the column.
 */
export function linkedEntity(id: string, name: string, types: unknown): LinkedEntity | null {
  const parsed = typesSchema.safeParse(types);
  return parsed.success ? { id, name, types: parsed.data } : null;
}
