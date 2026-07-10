import { entityTypeSchema, LinkedEntity } from '@hexly/domain';

/**
 * One end of a link, resolved live off `entities` — an edge never stores a name.
 *
 * `entities.type` is a plain text column, so a row can hold a value outside the code-known enum: a
 * legacy row, or a vault imported from a Hexly that knows an Entity Type this one does not. Such an
 * Entity has no shape any of these surfaces can draw, so it resolves to `null` and the caller drops
 * it — one unrenderable row must never fail a whole World's read.
 */
export function linkedEntity(id: string, name: string, type: string): LinkedEntity | null {
  const parsed = entityTypeSchema.safeParse(type);
  return parsed.success ? { id, name, type: parsed.data } : null;
}
