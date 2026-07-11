/**
 * **User-defined Type Definitions** (CONTEXT.md → Type Definition, ADR-0048): an Entity Type a
 * **World Owner** authors as *data*, scoped to one World, fields-only, rendered by the generic
 * Field view. The data twin of a **Plugin type** — a plugin registers its type in code; a World
 * Owner stores one of these in their World. The only thing code ever buys is a bespoke view;
 * everything a user-defined type needs (id, Fields, facets, entity-link Fields, primary, multi-type)
 * works code-lessly off this shape.
 *
 * The Zod source of truth for the model and its REST payloads. A user-defined type carries only an
 * `id`, a display `label`, and a **Field schema** (the same {@link fieldSchemaSchema} a plugin
 * declares, so its Fields — facetable flags, enum options, entity-link target constraints — behave
 * identically to a plugin's). It is stored per-World (cascading on World delete) and merged with the
 * instance-wide plugin types into the {@link AvailableType} set a World exposes.
 */

import { z } from 'zod';
import { entityTypeSchema, nameSchema } from './entity';
import { FieldSchema, fieldSchemaSchema } from './field';

/**
 * The namespace a user-defined type id lives under (`world.deity`, `world.faction`). Fixing it to
 * `world.` keeps a World Owner from shadowing a plugin type id (`core.note`, `dnd.monster`): the two
 * keyspaces never collide, so a World's `world.deity` and an instance plugin's `dnd.monster` are
 * always distinguishable. World *scoping* is by storage (the owning `worldId`), not by this
 * namespace — two Worlds may each define their own `world.deity` with different Fields.
 */
export const USER_TYPE_NAMESPACE = 'world';

/**
 * A user-defined Entity Type id: a `namespace.id` key (so it inhabits the same open Entity Type set)
 * forced into the reserved `world.` namespace. `world.deity` passes; `dnd.monster` or a bare
 * `deity` does not.
 */
export const userDefinedTypeIdSchema = entityTypeSchema.refine(
  (id) => id.startsWith(`${USER_TYPE_NAMESPACE}.`),
  `A user-defined type id must be in the \`${USER_TYPE_NAMESPACE}.\` namespace`,
);

/**
 * A Field schema list with **distinct keys**: a Field is a lens over one Metadata key, so two Fields
 * typing the same key are a contradiction the author must resolve, not a silent last-wins. Reused by
 * the create and update payloads.
 */
export const uniqueFieldsSchema = z
  .array(fieldSchemaSchema)
  .refine(
    (fields) => new Set(fields.map((f) => f.key)).size === fields.length,
    'Field keys must be unique within a type',
  );

/**
 * A stored user-defined type (CONTEXT.md → Type Definition): its `world.`-namespaced `id`, a
 * display `label`, and its `fields`. This is the shape the CRUD endpoints round-trip and the
 * per-World read merges into {@link AvailableType}.
 */
export const userDefinedTypeSchema = z.object({
  id: userDefinedTypeIdSchema,
  label: nameSchema,
  fields: uniqueFieldsSchema.default([]),
});

export type UserDefinedType = z.infer<typeof userDefinedTypeSchema>;

/**
 * POST /worlds/:id/types — author a new user-defined type. The full type shape *is* the create
 * payload (id + label + fields), so it reuses {@link userDefinedTypeSchema} rather than a byte-identical
 * twin that could drift. The `id` is client-supplied (it becomes the Entity Type key entities carry)
 * and immutable thereafter; `label` and `fields` are the editable surface a later PATCH revises.
 */
export const createUserDefinedTypeRequestSchema = userDefinedTypeSchema;

export type CreateUserDefinedTypeRequest = z.infer<typeof createUserDefinedTypeRequestSchema>;

/**
 * PATCH /worlds/:id/types/:typeId — rename (`label`) and/or replace the `fields` of an existing
 * user-defined type. The id is a path parameter and never changes (entities key off it); both body
 * fields are optional, and an absent one is left untouched. `fields` is sent wholesale — add, edit,
 * remove, and reorder all collapse to "send the new array", mirroring the World's pin set.
 */
export const updateUserDefinedTypeRequestSchema = z
  .object({
    label: nameSchema.optional(),
    fields: uniqueFieldsSchema.optional(),
  })
  .refine((body) => body.label !== undefined || body.fields !== undefined, 'A type update must change something');

export type UpdateUserDefinedTypeRequest = z.infer<typeof updateUserDefinedTypeRequestSchema>;

/**
 * Where an {@link AvailableType} comes from: a `plugin` type (registered in code, instance-wide) or
 * a `user` type (this World's authored data). The Entity Browser lists both under the Type facet;
 * the flavour lets a surface treat them differently (only a `user` type is editable here).
 */
export type AvailableTypeSource = 'plugin' | 'user';

/**
 * One Entity Type **available in a World** (ADR-0048): the union a World exposes for its create
 * dialog, facet labels, and view resolution — the instance-wide plugin types plus that World's
 * user-defined types. Carries the `id`, a `label`, its `fields`, and the `source` flavour. A World's
 * user-defined types never appear in another World's set (World scoping).
 */
export interface AvailableType {
  readonly id: string;
  readonly label: string;
  readonly source: AvailableTypeSource;
  readonly fields: readonly FieldSchema[];
}
