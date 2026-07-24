/**
 * Where a Type puts one of its **Views** in its own order (CONTEXT.md → View, ADR-0050).
 *
 * An entry is either a View id the type contributes outright, or a reference to one of the type's own
 * **Fields**, whose structured data-type contributes the View. The domain owns only the shape: it
 * neither knows the View keyspace nor resolves one.
 */

import * as z from 'zod';
import { kindedIdRegex } from './kinded-id';

/** A View id, opaque here: it resolves against the web's registry, and an unregistered one is inert. */
const viewIdSchema = z.string().regex(kindedIdRegex('view'), 'A View id must be a `namespace.view.name` key');

/** A reference to one of the declaring type's own Fields, by the EntityDocument key it types. */
const fieldViewPlacementSchema = z.object({ field: z.string().trim().min(1) });

export const viewPlacementSchema = z.union([viewIdSchema, fieldViewPlacementSchema]);

export type ViewPlacement = z.infer<typeof viewPlacementSchema>;

/** Whether a placement names one of the type's Fields, rather than a View the type contributes itself. */
export function isFieldViewPlacement(placement: ViewPlacement): placement is { field: string } {
  return typeof placement !== 'string';
}
