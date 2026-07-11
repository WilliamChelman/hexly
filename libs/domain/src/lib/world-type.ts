/**
 * User-defined Type Definitions (CONTEXT.md → Type Definition, ADR-0048): an Entity Type a World
 * Owner authors as data, scoped to one World, rendered by the generic Field view — the data twin of
 * a code-registered Plugin type. The Zod source of truth for the model and its REST payloads; a type
 * carries an `id`, a `label`, and the same {@link fieldSchemaSchema} a plugin declares.
 */

import { z } from 'zod';
import { entityTypeSchema, nameSchema } from './entity';
import { FieldSchema, fieldSchemaSchema } from './field';

/**
 * The namespace a user-defined type id lives under (`world.deity`). Fixing it to `world.` keeps a
 * World Owner from shadowing a plugin id (`core.note`, `dnd.monster`), so the keyspaces never
 * collide. World *scoping* is by storage (`worldId`), not this namespace.
 */
export const USER_TYPE_NAMESPACE = 'world';

/** A user-defined type id: a `namespace.id` key forced into the reserved `world.` namespace. */
export const userDefinedTypeIdSchema = entityTypeSchema.refine(
  (id) => id.startsWith(`${USER_TYPE_NAMESPACE}.`),
  `A user-defined type id must be in the \`${USER_TYPE_NAMESPACE}.\` namespace`,
);

/** A Field schema list with distinct keys — two Fields typing the same Metadata key are a mistake. */
export const uniqueFieldsSchema = z
  .array(fieldSchemaSchema)
  .refine(
    (fields) => new Set(fields.map((f) => f.key)).size === fields.length,
    'Field keys must be unique within a type',
  );

/** A stored user-defined type: its `world.`-namespaced `id`, a display `label`, and its `fields`. */
export const userDefinedTypeSchema = z.object({
  id: userDefinedTypeIdSchema,
  label: nameSchema,
  fields: uniqueFieldsSchema.default([]),
});

export type UserDefinedType = z.infer<typeof userDefinedTypeSchema>;

/** POST /worlds/:id/types — the full type shape is the create payload, so it reuses the type schema. */
export const createUserDefinedTypeRequestSchema = userDefinedTypeSchema;

export type CreateUserDefinedTypeRequest = z.infer<typeof createUserDefinedTypeRequestSchema>;

/**
 * PATCH /worlds/:id/types/:typeId — rename and/or replace an existing type's `fields`. The id is a
 * path param (immutable); both body fields are optional and `fields` is sent wholesale.
 */
export const updateUserDefinedTypeRequestSchema = z
  .object({
    label: nameSchema.optional(),
    fields: uniqueFieldsSchema.optional(),
  })
  .refine((body) => body.label !== undefined || body.fields !== undefined, 'A type update must change something');

export type UpdateUserDefinedTypeRequest = z.infer<typeof updateUserDefinedTypeRequestSchema>;

/** Where an {@link AvailableType} comes from: a code-registered `plugin` or this World's `user` data. */
export type AvailableTypeSource = 'plugin' | 'user';

/**
 * One Entity Type available in a World (ADR-0048): the plugin types plus that World's user-defined
 * types, for the create dialog, facet labels, and view resolution.
 */
export interface AvailableType {
  readonly id: string;
  readonly label: string;
  readonly source: AvailableTypeSource;
  readonly fields: readonly FieldSchema[];
}
