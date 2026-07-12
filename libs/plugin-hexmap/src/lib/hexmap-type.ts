/**
 * `core.hexmap` — the Hex Map Entity Type, declared through the same {@link defineType} a bundled
 * plugin's declaration goes through (ADR-0048, ADR-0050). It is the *only* thing that makes an Entity
 * a Hex Map: one **Structured Field**, the grid, at the `grid` key.
 *
 * The id keeps the `core.` namespace though the code compiles from a plugin lib: a namespace names
 * who owns the vocabulary, not which lib ships it, and `core.` still means "in the box" (ADR-0050).
 */

import { defineType, PluginTypeDefinition } from '@hexly/domain';
import { HEX_GRID_FIELD } from './hex-grid';

/** The Hex Map's Entity Type id. */
export const CORE_HEXMAP = 'core.hexmap';

/**
 * The Hex Map type. `label` is the untranslated fallback the API's available-types list reports —
 * the web resolves the name through transloco.
 */
export const CORE_HEXMAP_TYPE: PluginTypeDefinition = defineType({
  id: CORE_HEXMAP,
  label: 'Map',
  fields: [HEX_GRID_FIELD],
});
