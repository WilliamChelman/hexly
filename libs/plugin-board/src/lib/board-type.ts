/**
 * `core.board` — the Board Entity Type (CONTEXT.md → Board, #263). Its surface **Field of a Structured
 * Data Type** at the `core.surface` key is what makes an Entity a Board; it declares the canonical prose
 * {@link CONTENT_FIELD} beside it, so a Board carries lore like any other Entity (ADR-0051). The
 * free-positioned sibling of the Hex Map, and built the same way.
 *
 * The id keeps the `core.` namespace though the code ships from a plugin lib: a namespace names who owns
 * the vocabulary, not which lib ships it, and `core.` means "in the box" (ADR-0050).
 */

import { defineType, PluginTypeDefinition } from '@hexly/domain';
import { CONTENT_FIELD } from '@hexly/plugin-content';
import { SURFACE_FIELD } from './board-surface-type';

/** The Board's Entity Type id. */
export const CORE_BOARD = 'core.board';

/**
 * The Board type. `label` is the untranslated fallback; the web resolves the name through transloco.
 * References the prose (`core.content`) and surface (`core.surface`) Fields by id (`fieldRefs`,
 * ADR-0054) — the sole Field declaration. The surface View is the Board's default (user story 5), which
 * the `-web` half declares.
 */
export const CORE_BOARD_TYPE: PluginTypeDefinition = defineType({
  id: CORE_BOARD,
  label: 'Board',
  fieldRefs: [CONTENT_FIELD.id, SURFACE_FIELD.id],
});
