/**
 * Plugin types and `defineType` — the code-registered flavour of a Type Definition (CONTEXT.md →
 * Type Definition, ADR-0048). Its data twin, the World-scoped user-defined type, is `world-type.ts`.
 *
 * A declaration is framework-free because both sides consume it: the API resolves the Fields for
 * forward-only validation and faceting, the web adds the chrome and Views. `core.note`/`core.hexmap`
 * are declared through the same {@link defineType} a bundled plugin uses, so the plugin API stays
 * exercised.
 */

import { z } from 'zod';
import { CORE_HEXMAP, CORE_NOTE, entityTypeSchema, nameSchema } from './entity';
import { FieldSchema } from './field';
import { uniqueFieldsSchema } from './world-type';

/**
 * One code-registered Entity Type: its `namespace.id`, the display `label` used where the type is
 * named without translated copy (the API's available-types list), and the Field schema it declares.
 * Distinct from the web's `TypeDefinition`, which adds the icon, transloco chrome, and Views.
 */
export interface PluginTypeDefinition {
  readonly id: string;
  readonly label: string;
  readonly fields: readonly FieldSchema[];
}

const pluginTypeSchema = z.object({
  id: entityTypeSchema,
  label: nameSchema,
  fields: uniqueFieldsSchema.default([]),
});

/**
 * Declare a code-registered Entity Type — the constructor both a bundled plugin and the core go
 * through. Validates against the same Zod a user-defined type rides, so a malformed type (a bare id,
 * a duplicate Field key, an unknown data-type) throws at module load rather than at runtime.
 */
export function defineType(definition: {
  readonly id: string;
  readonly label: string;
  readonly fields?: readonly FieldSchema[];
}): PluginTypeDefinition {
  return Object.freeze(pluginTypeSchema.parse(definition));
}

/**
 * The two core types, declared through {@link defineType} as a plugin's are. They declare no Fields:
 * a Note is its Content, a Hex Map its Content plus a grid, so neither types a Metadata key. `label`
 * is the untranslated fallback — the web resolves their names through transloco.
 */
export const CORE_NOTE_TYPE = defineType({ id: CORE_NOTE, label: 'Note' });
export const CORE_HEXMAP_TYPE = defineType({ id: CORE_HEXMAP, label: 'Map' });

/** Every core type, for the registries that seed themselves from the code-registered set. */
export const CORE_TYPES: readonly PluginTypeDefinition[] = [CORE_NOTE_TYPE, CORE_HEXMAP_TYPE];
