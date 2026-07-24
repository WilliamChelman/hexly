/**
 * The **Field** id keyspace (CONTEXT.md → Field, ADR-0054) — a dependency-free leaf so both `entity.ts`
 * (an Entity's attached `fields`) and `field.ts` (a `Field`'s own `id`, a Type's `fieldRefs`) can share
 * it without the two forming a runtime import cycle: `field.ts` already imports `entityTypeSchema` as a
 * value, so `entity.ts` must not, in turn, need a value out of `field.ts`.
 */

import * as z from 'zod';
import { kindedIdRegex } from './kinded-id';

/**
 * A first-class Field `id`: a `namespace.field.name` key that *is* the Entity Document slot the Field
 * lenses — one identifier, the Field's single source of truth (ADR-0056). A rename touches only the
 * `label`, never this key, and no two Fields share it. The `field` kind segment keeps the keyspace
 * disjoint from Entity Type and Data Type ids (see `kinded-id.ts`).
 */
export const fieldIdSchema = z
  .string()
  .trim()
  .regex(kindedIdRegex('field'), 'A Field id must be a `namespace.field.name` key');

/** A deduped list of Field ids, order preserved — the raw list a Type's `fieldRefs` or an Entity's `fields` normalizes to. */
export const dedupedFieldIdsSchema = z.array(fieldIdSchema).transform((ids) => [...new Set(ids)]);

/**
 * A Type Definition's default `fieldRefs`, or an Entity's directly-attached `fields` (ADR-0054): a
 * {@link dedupedFieldIdsSchema} defaulting to empty, so an omitted list is a type/entity that references
 * no Field.
 */
export const fieldRefsSchema = dedupedFieldIdsSchema.default([]);
