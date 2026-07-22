/**
 * `core.type.asset` — the Asset Entity Type (CONTEXT.md → Asset, ADR-0065). One type for every kind
 * (image today; PDF, audio later — kind is a mime-derived facet, not a type). It defaults two Fields: the
 * asset-ref ({@link ASSET_FIELD}, the bytes' content-address handle) and the canonical **Content**
 * ({@link CONTENT_FIELD}, prose about the asset — credits, license, lore).
 *
 * The id keeps the `core.` namespace though the code ships from a plugin lib: a namespace names who owns the
 * vocabulary, not which lib ships it, and `core.` means "in the box" (ADR-0050).
 */

import { defineType, PluginTypeDefinition } from '@hexly/domain';
import { CONTENT_FIELD } from '@hexly/plugin-content';
import { ASSET_FIELD } from './asset-data-type';

/** The Asset's Entity Type id. */
export const CORE_ASSET_TYPE_ID = 'core.type.asset';

/**
 * The Asset type. `label` is the untranslated fallback; the web resolves the name through transloco.
 * References the asset-ref (`core.field.asset`) and prose (`core.field.content`) Fields by id (`fieldRefs`,
 * ADR-0054) — the sole Field declaration.
 */
export const CORE_ASSET_TYPE: PluginTypeDefinition = defineType({
  id: CORE_ASSET_TYPE_ID,
  label: 'Asset',
  fieldRefs: [ASSET_FIELD.id, CONTENT_FIELD.id],
});
