import { TypeDefinition, ViewId } from '@hexly/web-entity';
import { CORE_NOTE_TYPE } from '@hexly/plugin-content';

/** The Content View's id — the prose renderer the `core.rich-content` data-type contributes (ADR-0051). */
export const CORE_VIEW_CONTENT: ViewId = 'core.view.content';

/**
 * `core.note` as the web registers it (ADR-0051): the shared {@link CORE_NOTE_TYPE} declaration plus the
 * chrome only the web has — icon, transloco copy, graph colour, and where its content View sits.
 *
 * It places the content View by id, so the toggle keys plain (`core.view.content`) over its one prose
 * Field; a World type's *extra* prose Field places it by `{ field }` instead (ADR-0051). Imports no
 * component: {@link providePluginContent} defers the editor behind its `loadComponent`.
 */
export const CONTENT_TYPE_DEFINITIONS: readonly TypeDefinition[] = [
  {
    id: CORE_NOTE_TYPE.id,
    // References the prose Field by id (ADR-0054); `fields` kept for the World Types editor.
    fieldRefs: CORE_NOTE_TYPE.fieldRefs,
    icon: 'label',
    views: [CORE_VIEW_CONTENT],
    graphColorToken: '--color-ink-muted',
    // A plugin ships translated copy, so its chrome is its own `editor` scope keys (ADR-0049).
    labels: {
      eyebrow: 'editor.note.eyebrow',
      titleLabel: 'editor.note.titleLabel',
      rename: 'editor.note.rename',
      editorLabel: 'editor.note.editorLabel',
      create: 'editor.note.create',
      untitled: 'editor.note.untitled',
    },
  },
];
