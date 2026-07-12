/**
 * Where a Type puts one of its **Views** in its own order (CONTEXT.md → View, ADR-0050).
 *
 * A View is a web concept, and the domain neither knows the View keyspace nor resolves one. It owns
 * the *shape* of a placement because a **User-defined type** is data: its view list is persisted and
 * validated at the trust boundary like the rest of its declaration. The web's `TypeDefinition.views`
 * is this same shape, so a plugin type and a user-defined type run one view-resolution path (#201).
 *
 * An entry is either a View id the type contributes outright, or a reference to one of the type's own
 * **Fields**, whose structured data-type contributes the View.
 */

import { z } from 'zod';

/** A View id, opaque here: it resolves against the web's registry, and an unregistered one is inert. */
const viewIdSchema = z.string().regex(/^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/, 'A View id must be a `namespace.id` key');

/** A reference to one of the declaring type's own Fields, by the Metadata key it types. */
const fieldViewPlacementSchema = z.object({ field: z.string().trim().min(1) });

export const viewPlacementSchema = z.union([viewIdSchema, fieldViewPlacementSchema]);

export type ViewPlacement = z.infer<typeof viewPlacementSchema>;

/** Whether a placement names one of the type's Fields, rather than a View the type contributes itself. */
export function isFieldViewPlacement(placement: ViewPlacement): placement is { field: string } {
  return typeof placement !== 'string';
}
