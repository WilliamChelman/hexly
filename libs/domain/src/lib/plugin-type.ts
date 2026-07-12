/**
 * **Plugin types** and `defineType` — the code-registered flavour of a **Type Definition**
 * (CONTEXT.md → Type Definition, ADR-0048).
 *
 * A Type Definition comes in two flavours, and this module is the *code* one; its data twin, the
 * World-scoped **User-defined type**, is `world-type.ts` next door. Both reduce to the same thing —
 * an id, a display label, and a **Field** schema — which is why they sit side by side in the domain
 * and why a plugin buys nothing a World Owner can't author, except a bespoke view.
 *
 * A declaration is deliberately *framework-free*, because both sides consume it: the API resolves the
 * Fields for forward-only validation and faceting, and the web layers on the chrome and Views only it
 * has. **The core dogfoods this**: `core.note` and `core.hexmap` are declared through the same
 * {@link defineType} a bundled plugin uses (they simply declare no Fields), so the plugin API cannot
 * rot un-exercised.
 */

import { z } from 'zod';
import { CORE_HEXMAP, CORE_NOTE, entityTypeSchema, nameSchema } from './entity';
import { FieldSchema } from './field';
import { uniqueFieldsSchema } from './world-type';

/**
 * One code-registered Entity Type: its `namespace.id`, the display `label` shown wherever the type is
 * named without translated copy (the API's available-types list), and the Field schema it declares.
 *
 * Not the web's own `TypeDefinition` — icon, transloco chrome, and Views are Angular concerns the web
 * adds on top of this shared declaration, so the API never learns that components exist.
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
 * Declare a code-registered Entity Type — the one constructor a bundled plugin and the core both go
 * through. It validates the declaration against the same Zod a user-defined type rides, so a
 * malformed type (a bare id, a duplicate Field key, an unknown data-type) fails loudly at module load
 * rather than degrading a World's Entities at runtime. Returns the frozen, parsed declaration.
 */
export function defineType(definition: {
  readonly id: string;
  readonly label: string;
  readonly fields?: readonly FieldSchema[];
}): PluginTypeDefinition {
  return Object.freeze(pluginTypeSchema.parse(definition));
}

/**
 * The two core types, declared through {@link defineType} exactly as a plugin's are — the dogfooding
 * ADR-0048 asks for, in code rather than in a comment. They declare no Fields: a Note is its Content,
 * and a Hex Map is its Content plus a grid, so neither types a Metadata key. The `label` is the
 * untranslated fallback; the web resolves their names through transloco instead.
 */
export const CORE_NOTE_TYPE = defineType({ id: CORE_NOTE, label: 'Note' });
export const CORE_HEXMAP_TYPE = defineType({ id: CORE_HEXMAP, label: 'Map' });

/** Every core type, for the registries that seed themselves from the code-registered set. */
export const CORE_TYPES: readonly PluginTypeDefinition[] = [CORE_NOTE_TYPE, CORE_HEXMAP_TYPE];
