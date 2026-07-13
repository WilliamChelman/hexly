/**
 * `core.hexmap` — the Hex Map Entity Type. One **Structured Field**, the grid, at the `grid` key, is
 * the *only* thing that makes an Entity a Hex Map.
 *
 * The id keeps the `core.` namespace though the code ships from a plugin lib: a namespace names who
 * owns the vocabulary, not which lib ships it, and `core.` means "in the box" (ADR-0050).
 */

import { defineType, PluginTypeDefinition } from '@hexly/domain';
import { HEX_GRID_FIELD } from './hex-grid';

/** The Hex Map's Entity Type id. */
export const CORE_HEXMAP = 'core.hexmap';

/** The Hex Map type. `label` is the untranslated fallback; the web resolves the name through transloco. */
export const CORE_HEXMAP_TYPE: PluginTypeDefinition = defineType({
  id: CORE_HEXMAP,
  label: 'Map',
  fields: [HEX_GRID_FIELD],
});
