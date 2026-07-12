import { CORE_NOTE_TYPE } from '@hexly/domain';
import { CORE_VIEW_CONTENT, TypeDefinition } from '@hexly/web-entity';

/**
 * The one Entity Type the app registers itself: its `defineType` declaration — the constructor a
 * bundled plugin's declaration also goes through — plus the chrome only the web has. It enters the
 * {@link TypeRegistry} through the same `register()` a plugin's does (ADR-0048).
 *
 * `core.note` declares no Fields, so an Entity carrying it is nothing but its body: it contributes
 * only `core.view.content`. It is the one type the app registers, and the only type id `apps/web`
 * names, because Content is the base body every Entity has rather than a Type's contribution — every
 * other type, the Hex Map included, arrives from a plugin (ADR-0050).
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
