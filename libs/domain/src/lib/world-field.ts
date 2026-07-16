/**
 * World-defined **Fields** (CONTEXT.md → Field, ADR-0054): a first-class {@link Field} a World Owner
 * authors as data, scoped to one World and reserved to the `world.` namespace — the data twin of a
 * code-registered Plugin field (`defineField`). Stored in a `world_fields` collection beside
 * `world_types`, composed into the effective-set resolver alongside the Plugin fields, and degrading
 * forward-only: a deleted (or re-keyed) World Field simply stops resolving, leaving its document values
 * as plain values rather than erroring.
 */

import { z } from 'zod';
import { fieldSchema, fieldSchemaSchema } from './field';
import { fieldIdSchema } from './field-id';

/**
 * The namespace a World-defined Field id lives under (`world.element`). Reserved, so a World Owner can
 * never shadow a Plugin field id (`dnd.size`, `core.content`). World *scoping* is by storage
 * (`worldId`), not this namespace — the same split {@link USER_TYPE_NAMESPACE} draws for user-defined
 * types.
 */
export const USER_FIELD_NAMESPACE = 'world';

/** A World-defined Field id: a {@link fieldIdSchema} forced into the reserved `world.` namespace. */
export const userDefinedFieldIdSchema = fieldIdSchema.refine(
  (id) => id.startsWith(`${USER_FIELD_NAMESPACE}.`),
  `A World-defined Field id must be in the \`${USER_FIELD_NAMESPACE}.\` namespace`,
);

/**
 * A stored World-defined Field: a {@link fieldSchema} whose `id` is forced into the `world.` namespace.
 * Structurally a {@link Field}, so it composes into the resolver and every downstream pure function
 * unchanged.
 */
export const worldFieldSchema = fieldSchema.extend({ id: userDefinedFieldIdSchema });

export type WorldField = z.infer<typeof worldFieldSchema>;

/** POST /worlds/:id/fields — the full Field shape is the create payload, so it reuses the Field schema. */
export const createWorldFieldRequestSchema = worldFieldSchema;

export type CreateWorldFieldRequest = z.infer<typeof createWorldFieldRequestSchema>;

/**
 * PATCH /worlds/:id/fields/:fieldId. The id is a path param (immutable — followers key off it); the
 * body is the Field's editable attributes, sent wholesale (the whole `FieldSchema`, no `id`), mirroring
 * how a user-defined type re-sends its `fields` list.
 */
export const updateWorldFieldRequestSchema = fieldSchemaSchema;

export type UpdateWorldFieldRequest = z.infer<typeof updateWorldFieldRequestSchema>;
