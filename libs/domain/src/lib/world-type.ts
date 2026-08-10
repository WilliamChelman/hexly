/**
 * User-defined Type Definitions (CONTEXT.md → Type Definition, ADR-0048): an Entity Type a World
 * Owner authors as data, scoped to one World, rendered by the generic Field view — the data twin of
 * a code-registered Plugin type.
 */

import * as z from 'zod';
import { entityTypeSchema, nameSchema } from './entity';
import { dedupedFieldIdsSchema, fieldRefsSchema } from './field-id';
import { slugifySegment } from './slug';
import { ViewPlacement, viewPlacementSchema } from './view-placement';

/**
 * The namespace a user-defined type id lives under (`world.type.deity`). Reserved, so a World Owner can
 * never shadow a plugin id (`core.type.note`, `dnd.type.monster`). World *scoping* is by storage (`worldId`),
 * not this namespace.
 */
export const USER_TYPE_NAMESPACE = 'world';

/** A user-defined type id: a `namespace.type.name` key forced into the reserved `world.` namespace. */
export const userDefinedTypeIdSchema = entityTypeSchema.refine(
  (id) => id.startsWith(`${USER_TYPE_NAMESPACE}.`),
  `A user-defined type id must be in the \`${USER_TYPE_NAMESPACE}.\` namespace`,
);

/** Build a `world.type.<segment>` id from an editable segment — the `type` kind segment is minted, never typed (see `kinded-id.ts`). */
export function worldTypeIdFromSegment(segment: string): string {
  return `${USER_TYPE_NAMESPACE}.type.${segment}`;
}

/** Slug a raw label into the `world.`-less segment of a user-defined type id (ADR-0056); may return `''`. */
export function slugifyTypeSegment(raw: string): string {
  return slugifySegment(raw);
}

/**
 * Derive the frozen, immutable `world.type.<slug>` id for a label minted inline (#438), disambiguating
 * with a numeric suffix (`-2`, `-3`, …) on collision so a mint never reuses another type's key.
 */
export function deriveWorldTypeId(label: string, existingIds: Iterable<string> = []): string {
  // A label with no Latin alphanumerics ("神", "❤️") slugs to '' and would mint an invalid id (#438);
  // fall back to a stable generic base — the label is preserved verbatim, the slug is hidden.
  const slug = slugifyTypeSegment(label) || 'type';
  const taken = new Set(existingIds);
  let candidate = worldTypeIdFromSegment(slug);
  for (let n = 2; taken.has(candidate); n++) candidate = worldTypeIdFromSegment(`${slug}-${n}`);
  return candidate;
}

/** The editable segment of a `world.type.<segment>` id — the inverse of {@link worldTypeIdFromSegment}, for form prefill. */
export function worldTypeSegment(id: string): string {
  return id.slice(`${USER_TYPE_NAMESPACE}.type.`.length);
}

/**
 * A user-defined type's ordered {@link ViewPlacement} list (ADR-0050). A well-formed id this build
 * does not register is valid here — it simply contributes no toggle. A `{ field }` placement names
 * the EntityDocument key of a Field the type references; one the effective set can't resolve is inert,
 * not rejected (ADR-0054, forward-only), so the domain checks only its shape, never key membership —
 * the type carries Field *ids* (`fieldRefs`), not the keys a placement names.
 */
const typeViewsSchema = z.array(viewPlacementSchema);

/**
 * A stored user-defined type (ADR-0054): its default Fields are referenced by id (`fieldRefs`) only —
 * no inline schema, one resolution path (id → Field). `views` **absent is not empty**: a type that
 * named no order falls back to Fields, Content, then its Fields of a **Structured Data Type** —
 * defaulted by the host.
 */
export const userDefinedTypeSchema = z.object({
  id: userDefinedTypeIdSchema,
  label: nameSchema,
  fieldRefs: fieldRefsSchema,
  views: typeViewsSchema.optional(),
});

export type UserDefinedType = z.infer<typeof userDefinedTypeSchema>;

/** POST /worlds/:id/types — the full type shape is the create payload, so it reuses the type schema. */
export const createUserDefinedTypeRequestSchema = userDefinedTypeSchema;

export type CreateUserDefinedTypeRequest = z.infer<typeof createUserDefinedTypeRequestSchema>;

/**
 * PATCH /worlds/:id/types/:typeId. The id is a path param (immutable); every body field is optional
 * and each list is sent wholesale. A `views` placement naming a Field the type no longer references
 * is inert at resolution (ADR-0054), so no cross-list check is needed here.
 */
export const updateUserDefinedTypeRequestSchema = z
  .object({
    label: nameSchema.optional(),
    fieldRefs: dedupedFieldIdsSchema.optional(),
    views: typeViewsSchema.optional(),
  })
  .refine(
    (body) => body.label !== undefined || body.fieldRefs !== undefined || body.views !== undefined,
    'A type update must change something',
  );

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
  /** The default Fields this type references by id (`fieldRefs`, ADR-0054) — the sole Field declaration. */
  readonly fieldRefs: readonly string[];
  /**
   * A **user-defined** type's ordered View list, as authored. Absent on a plugin type, which declares
   * its own in code, and on a user-defined type that never named an order (the host defaults it).
   */
  readonly views?: readonly ViewPlacement[];
  /**
   * The generic hidden-from-default-listing capability (ADR-0065), carried from the type's declaration so
   * surfaces can honour it without naming a type. Set today only by code-registered types (the asset type);
   * absent → the ordinary always-listed type.
   */
  readonly hiddenFromDefaultListing?: boolean;
  /**
   * **System-managed** (CONTEXT.md → System-managed, ADR-0068): the marker projected across the web seam so
   * the add-type picker can stop offering it and the Details panel render it affordance-less. Set today only
   * by the code-registered asset type; absent → an ordinary user-assignable type.
   */
  readonly systemManaged?: boolean;
}
