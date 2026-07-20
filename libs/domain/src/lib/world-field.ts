/**
 * World-defined **Fields** (CONTEXT.md → Field, ADR-0054/ADR-0056): a first-class {@link Field} a World
 * Owner authors as data, scoped to one World and reserved to the `world.` namespace — the data twin of a
 * code-registered Plugin field (`defineField`). Stored in a `world_fields` collection beside
 * `world_types`, composed into the effective-set resolver alongside the Plugin fields, and degrading
 * forward-only: a deleted World Field simply stops resolving, leaving its document values as plain values
 * rather than erroring.
 *
 * Its `world.field.<segment>` id is auto-slugged from the `label` on create and frozen (ADR-0056):
 * renaming is label-only, and no re-key path exists. The `field` kind segment is minted here, never
 * typed by the user (see `kinded-id.ts`).
 */

import { z } from 'zod';
import { fieldSchema, fieldSchemaSchema } from './field';
import { fieldIdSchema } from './field-id';

/**
 * The namespace a World-defined Field id lives under (`world.field.element`). Reserved, so a World Owner can
 * never shadow a Plugin field id (`dnd.field.size`, `core.field.content`). World *scoping* is by storage
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

/**
 * Slug a raw label segment into the `world.`-less portion of a World Field id (ADR-0056): accent-fold,
 * lowercase, dash-collapse to the {@link fieldIdSchema} shape. Its own copy, not the web's `slugify`, so
 * the API can derive the id server-side; idempotent, so the form's pre-slug and this re-slug agree.
 */
export function slugifyFieldSegment(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip the combining diacritics NFD split off
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Build the frozen `world.field.<segment>` id (== document key) from an editable segment (ADR-0056). */
export function worldFieldIdFromSegment(segment: string): string {
  return `${USER_FIELD_NAMESPACE}.field.${slugifyFieldSegment(segment)}`;
}

/** The editable segment of a `world.field.<segment>` id — the inverse of {@link worldFieldIdFromSegment}, for form prefill. */
export function worldFieldSegment(id: string): string {
  return id.slice(`${USER_FIELD_NAMESPACE}.field.`.length);
}

/**
 * POST /worlds/:id/fields (ADR-0056): the Field body plus an editable `segment`, never a client-chosen
 * id/key — the server derives `world.field.<segment>` and returns the resolved Field.
 */
export const createWorldFieldRequestSchema = fieldSchemaSchema.extend({
  segment: z
    .string()
    .trim()
    .min(1)
    .refine((segment) => slugifyFieldSegment(segment).length > 0, 'A Field segment must slug to a non-empty key'),
});

export type CreateWorldFieldRequest = z.infer<typeof createWorldFieldRequestSchema>;

/**
 * PATCH /worlds/:id/fields/:fieldId. The id/key is immutable (a path param, ADR-0056): the body carries
 * the editable attributes without a key or id, so renaming is label-only.
 */
export const updateWorldFieldRequestSchema = fieldSchemaSchema;

export type UpdateWorldFieldRequest = z.infer<typeof updateWorldFieldRequestSchema>;
