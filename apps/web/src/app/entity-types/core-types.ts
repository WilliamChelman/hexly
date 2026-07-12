import { CORE_HEXMAP_TYPE, CORE_NOTE_TYPE } from '@hexly/domain';
import { CORE_VIEW_CONTENT, CORE_VIEW_MAP, TypeDefinition } from '@hexly/web-entity';

/**
 * The two core Entity Types as the web registers them: the domain's `defineType` declarations — the
 * constructor a bundled plugin's declaration also goes through — plus the chrome only the web has.
 * They enter the {@link TypeRegistry} through the same `register()` a plugin's do (ADR-0048).
 *
 * `core.note` adds no payload beyond the `rich-content` base and so contributes only the
 * `core.view.content` View; `core.hexmap` adds the `hex-grid` payload and so also contributes
 * `core.view.map`.
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
  {
    id: CORE_HEXMAP_TYPE.id,
    fields: CORE_HEXMAP_TYPE.fields,
    icon: 'terrain',
    views: [CORE_VIEW_MAP, CORE_VIEW_CONTENT],
    graphColorToken: '--color-gold',
    labels: {
      eyebrow: 'editorShell.hexMap',
      titleLabel: 'editorShell.mapTitleLabel',
      rename: 'editorShell.renameMap',
      editorLabel: 'editorShell.view.editorLabel',
      create: 'commandPalette.createMap',
      untitled: 'domain.untitledMap',
    },
  },
];
