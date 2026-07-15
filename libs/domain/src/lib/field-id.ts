/**
 * The **Field** id keyspace (CONTEXT.md → Field, ADR-0054) — a dependency-free leaf so both `entity.ts`
 * (an Entity's attached `fields`) and `field.ts` (a `Field`'s own `id`, a Type's `fieldRefs`) can share
 * it without the two forming a runtime import cycle: `field.ts` already imports `entityTypeSchema` as a
 * value, so `entity.ts` must not, in turn, need a value out of `field.ts`.
 */

import { z } from 'zod';

/**
 * A first-class Field `id`: a `namespace.id` reuse handle — the Field's single source of truth —
 * deliberately distinct from the document `key` it lenses, so renaming a label once updates every
 * follower while imported frontmatter at the bare key is still recognized (ADR-0033/0054). Same
 * keyspace shape as an Entity Type id.
 */
export const fieldIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/, 'A Field id must be a `namespace.id` key');

/** A deduped list of Field ids, order preserved — the raw list a Type's `fieldRefs` or an Entity's `fields` normalizes to. */
export const dedupedFieldIdsSchema = z.array(fieldIdSchema).transform((ids) => [...new Set(ids)]);

/**
 * A Type Definition's default `fieldRefs`, or an Entity's directly-attached `fields` (ADR-0054): a
 * {@link dedupedFieldIdsSchema} defaulting to empty, so an omitted list is a type/entity that references
 * no Field.
 */
export const fieldRefsSchema = dedupedFieldIdsSchema.default([]);
