/**
 * `core.note` — the Note Entity Type. It declares exactly one Field, the canonical
 * {@link CONTENT_FIELD}: a Note is nothing but its prose (ADR-0051).
 *
 * The id keeps the `core.` namespace though it ships from a plugin lib: a namespace names who owns the
 * vocabulary, not which lib ships it, and `core.` means "in the box" (ADR-0050).
 */

import { defineType, PluginTypeDefinition } from '@hexly/domain';
import { CONTENT_FIELD } from './rich-content';

/** The Note's Entity Type id. */
export const CORE_NOTE = 'core.note';

/**
 * The Note type. `label` is the untranslated fallback; the web resolves the name through transloco.
 * References the prose Field by id (`fieldRefs`, ADR-0054); inline `fields` remain for the web.
 */
export const CORE_NOTE_TYPE: PluginTypeDefinition = defineType({
  id: CORE_NOTE,
  label: 'Note',
  fields: [CONTENT_FIELD],
  fieldRefs: [CONTENT_FIELD.id],
});
