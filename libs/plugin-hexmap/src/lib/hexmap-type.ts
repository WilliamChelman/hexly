/**
 * `core.hexmap` — the Hex Map Entity Type. Its grid **Field of a Structured Data Type** at the `grid` key is what
 * makes an Entity a Hex Map; it declares the canonical prose {@link CONTENT_FIELD} beside it, so a Hex
 * Map carries lore like any other Entity (ADR-0051).
 *
 * The id keeps the `core.` namespace though the code ships from a plugin lib: a namespace names who
 * owns the vocabulary, not which lib ships it, and `core.` means "in the box" (ADR-0050).
 */

import { defineType, PluginTypeDefinition } from '@hexly/domain';
import { CONTENT_FIELD } from '@hexly/plugin-content';
import { HEX_GRID_FIELD } from './hex-grid';

/** The Hex Map's Entity Type id. */
export const CORE_HEXMAP = 'core.hexmap';

/** The Hex Map type. `label` is the untranslated fallback; the web resolves the name through transloco. */
export const CORE_HEXMAP_TYPE: PluginTypeDefinition = defineType({
  id: CORE_HEXMAP,
  label: 'Map',
  fields: [CONTENT_FIELD, HEX_GRID_FIELD],
});
