import { CORE_NOTE_TYPE } from '@hexly/plugin-content';
import { CORE_VIEW_CONTENT, TypeDefinition } from '@hexly/web-entity';

/**
 * `core.note`'s chrome, registered by the app. Its Fields come from the plugin now — the canonical
 * prose `CONTENT_FIELD` (ADR-0051) — while the icon, labels, and `core.view.content` View stay here
 * until they move into the plugin (the next ticket).
 *
 * The label values are transloco keys (see `libs/web-core/src/i18n/catalogs`).
 */
export const CORE_TYPE_DEFINITIONS: readonly TypeDefinition[] = [
  {
    id: CORE_NOTE_TYPE.id,
    fields: CORE_NOTE_TYPE.fields,
    icon: 'label',
    views: [CORE_VIEW_CONTENT],
    graphColorToken: '--color-ink-muted',
    labels: {
      eyebrow: 'noteView.eyebrow',
      titleLabel: 'noteView.titleLabel',
      rename: 'noteView.renameNote',
      editorLabel: 'noteView.editorLabel',
      create: 'commandPalette.createNote',
      untitled: 'domain.untitledNote',
    },
  },
];
