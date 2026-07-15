/**
 * Plugin types and `defineType` — the code-registered flavour of a Type Definition (CONTEXT.md →
 * Type Definition, ADR-0048). Its data twin, the World-scoped user-defined type, is `world-type.ts`.
 *
 * A declaration is framework-free: both sides consume it — the API resolves the Fields for
 * forward-only validation and faceting, the web adds the chrome and Views.
 */

import { z } from 'zod';
import { entityTypeSchema, nameSchema } from './entity';
import { FieldSchema } from './field';
import { fieldRefsSchema } from './field-id';
import { uniqueFieldsSchema } from './world-type';

/**
 * One code-registered Entity Type: its `namespace.id`, the display `label` used where the type is
 * named without translated copy (the API's available-types list), the inline Field schema it declares
 * (ADR-0048, retained), and the default Field ids it references (`fieldRefs`, ADR-0054). Distinct from
 * the web's `TypeDefinition`, which adds the icon, transloco chrome, and Views.
 */
export interface PluginTypeDefinition {
  readonly id: string;
  readonly label: string;
  readonly fields: readonly FieldSchema[];
  /** Default Fields this type references by id (ADR-0054). The additive successor to inline `fields`. */
  readonly fieldRefs: readonly string[];
}

const pluginTypeSchema = z.object({
  id: entityTypeSchema,
  label: nameSchema,
  fields: uniqueFieldsSchema.default([]),
  fieldRefs: fieldRefsSchema,
});

/**
 * Declare a code-registered Entity Type. A malformed type (a bare id, a duplicate Field key, an
 * unknown data-type, a malformed `fieldRef` id) throws at module load rather than at runtime.
 */
export function defineType(definition: {
  readonly id: string;
  readonly label: string;
  readonly fields?: readonly FieldSchema[];
  readonly fieldRefs?: readonly string[];
}): PluginTypeDefinition {
  return Object.freeze(pluginTypeSchema.parse(definition));
}
