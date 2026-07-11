/**
 * `defineType` — the **Plugin type** registration API (CONTEXT.md → Type Definition, ADR-0048).
 *
 * A bundled plugin teaches Hexly a whole kind of thing by declaring one of these at startup: a
 * `namespace.id` key, a display label, and a **Field** schema (a typing lens over the Entity's one
 * Metadata map). The declaration is *framework-free* on purpose, because it is consumed by **both**
 * sides — the API resolves the Fields for forward-only validation and faceting, and the web registers
 * them alongside the type's bespoke Angular View. A plugin that ships a view declares it web-side,
 * where components live; everything a plugin needs to work *without* code — Fields, facets, links —
 * is right here.
 *
 * The core dogfoods this: `core.note` / `core.hexmap` register through the same registries a plugin
 * does (they simply declare no Fields, so they have nothing to say here).
 */

import { entityTypeSchema, FieldSchema, nameSchema, uniqueFieldsSchema } from '@hexly/domain';
import { z } from 'zod';

/**
 * One bundled plugin's Entity Type: its `namespace.id`, the display `label` the API reports for the
 * create picker and facet rail, and the Field schema it declares. Deliberately *not* the web's
 * `TypeDefinition` — icon, transloco chrome, and Views are Angular concerns the web half adds on top
 * of this one shared declaration, so the API never learns about components.
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
 * Declare a Plugin type, validating it through the same Zod the API and a user-defined type ride —
 * a malformed plugin (a bare id, a duplicate Field key, an unknown data-type) fails loudly at module
 * load rather than degrading a World's Entities at runtime. Returns the frozen, parsed definition.
 */
export function defineType(definition: PluginTypeDefinition): PluginTypeDefinition {
  return Object.freeze(pluginTypeSchema.parse(definition));
}
