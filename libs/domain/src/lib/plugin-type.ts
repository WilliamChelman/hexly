/**
 * Plugin types and `defineType` — the code-registered flavour of a Type Definition (CONTEXT.md →
 * Type Definition, ADR-0048). Its data twin, the World-scoped user-defined type, is `world-type.ts`.
 *
 * A declaration is framework-free because both sides consume it: the API resolves the Fields for
 * forward-only validation and faceting, the web adds the chrome and Views. `core.note` is declared
 * through the same {@link defineType} a bundled plugin uses — and every other type, the Map's
 * included, *is* a plugin's (ADR-0050) — so the plugin API stays exercised.
 */

import { z } from 'zod';
import { CORE_NOTE, entityTypeSchema, nameSchema } from './entity';
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
 * The one type the core declares, through {@link defineType} as a plugin's is: `core.note` declares no
 * Fields at all — a Note is nothing but its body. `label` is the untranslated fallback — the web
 * resolves the name through transloco.
 */
export const CORE_NOTE_TYPE = defineType({ id: CORE_NOTE, label: 'Note' });

/**
 * Every core type, for the registries that seed themselves from the code-registered set. One today: a
 * host's other types come from the plugins it bundles, the Map plugin's among them (ADR-0050).
 */
export const CORE_TYPES: readonly PluginTypeDefinition[] = [CORE_NOTE_TYPE];
