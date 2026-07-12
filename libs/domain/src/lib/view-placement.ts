/**
 * Where a Type puts one of its **Views** in its own order (CONTEXT.md → View, ADR-0050).
 *
 * A **View** is a web concept — a renderer and an editor — and the domain neither knows the View
 * keyspace nor could resolve one. It owns only the *shape* of a placement, and for one reason: a
 * **User-defined type** is data, so its ordered view list is persisted, sent over the wire, and
 * validated at the trust boundary like every other part of its declaration. The web's own
 * `TypeDefinition.views` is this same shape, so a plugin type and a user-defined type run **one**
 * view-resolution path (#201) rather than a second branch for the code-less half.
 *
 * An entry is either a View id the type contributes outright, or a reference to one of the type's own
 * **Fields**, whose structured data-type contributes the View. Which is what lets a type built *around*
 * a structured Field open on it, while a `world.deity` that merely carries one still opens on its
 * Fields: the type *places* the Field's View, rather than an implicit rule putting a structured
 * Field's View always first (or always last) — wrong in both directions.
 */

import { z } from 'zod';

/**
 * A View id as the domain sees it: an opaque `namespace.id` key. It resolves against the web's View
 * registry, so a well-formed id this build does not register contributes nothing — the same
 * absent-plugin tolerance a Field's structured data-type gets.
 */
const viewIdSchema = z.string().regex(/^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/, 'A View id must be a `namespace.id` key');

/** A reference to one of the declaring type's own Fields, by the Metadata key it types. */
const fieldViewPlacementSchema = z.object({ field: z.string().trim().min(1) });

export const viewPlacementSchema = z.union([viewIdSchema, fieldViewPlacementSchema]);

export type ViewPlacement = z.infer<typeof viewPlacementSchema>;

/** Whether a placement names one of the type's Fields (rather than a View the type contributes itself). */
export function isFieldViewPlacement(placement: ViewPlacement): placement is { field: string } {
  return typeof placement !== 'string';
}
