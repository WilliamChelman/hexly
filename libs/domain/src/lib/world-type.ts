/**
 * User-defined Type Definitions (CONTEXT.md → Type Definition, ADR-0048): an Entity Type a World
 * Owner authors as data, scoped to one World, rendered by the generic Field view — the data twin of
 * a code-registered Plugin type. The Zod source of truth for the model and its REST payloads; a type
 * carries an `id`, a `label`, and the same {@link fieldSchemaSchema} a plugin declares.
 */

import { z } from 'zod';
import { entityTypeSchema, nameSchema } from './entity';
import { FieldSchema, fieldSchemaSchema } from './field';
import { isFieldViewPlacement, ViewPlacement, viewPlacementSchema } from './view-placement';

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

/**
 * A user-defined type's ordered **View** list (ADR-0050, #201) — the same {@link ViewPlacement} list a
 * plugin type declares in code, so both run one view-resolution path. A `{ field }` entry must name
 * one of the type's own Fields: a type cannot place a View for a Field it does not declare.
 *
 * Which Views the ids resolve to is the web's business, not the domain's — a user-defined type can
 * only resolve the generic Field view, the Content view, and its own **Structured Fields**, and an id
 * outside that set simply contributes no toggle.
 */
const typeViewsSchema = z.array(viewPlacementSchema);

/**
 * The shared refinement both payloads carry: every `{ field }` **View** placement names a Field the
 * same declaration makes. Shared as arguments to `.refine(...)` because the two schemas differ in
 * their optionality, not in this rule.
 *
 * An update patching `views` without `fields` fails it, which is the point: the two travel together,
 * so re-Fielding a type can never orphan a placement.
 */
const placesOnlyItsOwnFields = [
  (type: { fields?: readonly FieldSchema[]; views?: readonly ViewPlacement[] }) => {
    const keys = new Set((type.fields ?? []).map((field) => field.key));
    return (type.views ?? []).every((view) => !isFieldViewPlacement(view) || keys.has(view.field));
  },
  'A View placement must name one of the type’s own Fields',
] as const;

/**
 * A stored user-defined type: its `world.`-namespaced `id`, a display `label`, its `fields`, and the
 * optional ordered `views` those Fields and the core afford.
 *
 * `views` is **optional, and absent is not empty**: a type that never named an order falls back to
 * Fields, then Content, then its Structured Fields (resolved by the host, which is the only half that
 * knows what a View is) — so a deity that grows a battlemap still opens on its Fields.
 */
export const userDefinedTypeSchema = z
  .object({
    id: userDefinedTypeIdSchema,
    label: nameSchema,
    fields: uniqueFieldsSchema.default([]),
    views: typeViewsSchema.optional(),
  })
  .refine(...placesOnlyItsOwnFields);

export type UserDefinedType = z.infer<typeof userDefinedTypeSchema>;

/** POST /worlds/:id/types — the full type shape is the create payload, so it reuses the type schema. */
export const createUserDefinedTypeRequestSchema = userDefinedTypeSchema;

export type CreateUserDefinedTypeRequest = z.infer<typeof createUserDefinedTypeRequestSchema>;

/**
 * PATCH /worlds/:id/types/:typeId — rename and/or replace an existing type's `fields` and `views`. The
 * id is a path param (immutable); every body field is optional and each list is sent wholesale.
 *
 * A `views` patch is checked against the `fields` **in the same patch**, which is all a payload schema
 * can see: so placing one of the type's Fields means sending that Field with it, as the editor always
 * does. The other half of the invariant — that re-Fielding a type without re-placing its Views cannot
 * orphan a stored placement — needs the *stored* type, so the host prunes it there (WorldTypesService).
 */
export const updateUserDefinedTypeRequestSchema = z
  .object({
    label: nameSchema.optional(),
    fields: uniqueFieldsSchema.optional(),
    views: typeViewsSchema.optional(),
  })
  .refine(
    (body) => body.label !== undefined || body.fields !== undefined || body.views !== undefined,
    'A type update must change something',
  )
  .refine(...placesOnlyItsOwnFields);

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
  /**
   * A **user-defined** type's ordered View list, as authored (#201). Absent on a plugin type, which
   * declares its own in code and never round-trips it through the API — and absent on a user-defined
   * type that has never named an order, which the host defaults for it.
   */
  readonly views?: readonly ViewPlacement[];
}
