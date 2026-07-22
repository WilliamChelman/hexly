/**
 * Plugin types and `defineType` — the code-registered flavour of a Type Definition (CONTEXT.md →
 * Type Definition, ADR-0048). Its data twin, the World-scoped user-defined type, is `world-type.ts`.
 *
 * A declaration is framework-free: both sides consume it — the API resolves the Fields for
 * forward-only validation and faceting, the web adds the chrome and Views.
 */

import * as z from 'zod';
import { entityTypeSchema, nameSchema } from './entity';
import { fieldRefsSchema } from './field-id';

/**
 * One code-registered Entity Type: its `namespace.id`, the display `label` used where the type is
 * named without translated copy (the API's available-types list), and the default Field ids it
 * references (`fieldRefs`, ADR-0054). A Type Definition owns no inline Field schema — one field
 * concept, one resolution path (id → Field). Distinct from the web's `TypeDefinition`, which adds the
 * icon, transloco chrome, and Views.
 */
export interface PluginTypeDefinition {
  readonly id: string;
  readonly label: string;
  /** The default Fields this type references by id (ADR-0054) — the sole way a Type declares its Fields. */
  readonly fieldRefs: readonly string[];
  /**
   * A generic Type Definition capability (ADR-0065): the Entity Browser omits a type that sets this from its
   * default result set, surfacing its Entities only once the type is explicitly selected in the type facet.
   * The asset type sets it so bulk-imported media never drowns authored work — but the capability names no
   * type, so the Browser honours the declaration alone. Absent → the ordinary always-listed type.
   */
  readonly hiddenFromDefaultListing?: boolean;
}

const pluginTypeSchema = z.object({
  id: entityTypeSchema,
  label: nameSchema,
  fieldRefs: fieldRefsSchema,
  hiddenFromDefaultListing: z.boolean().optional(),
});

/**
 * Declare a code-registered Entity Type. A malformed type (a bare id, a malformed `fieldRef` id)
 * throws at module load rather than at runtime.
 */
export function defineType(definition: {
  readonly id: string;
  readonly label: string;
  readonly fieldRefs?: readonly string[];
  readonly hiddenFromDefaultListing?: boolean;
}): PluginTypeDefinition {
  return Object.freeze(pluginTypeSchema.parse(definition));
}
