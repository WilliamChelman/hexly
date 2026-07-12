import { CORE_HEXMAP_TYPE, CORE_NOTE_TYPE } from '@hexly/domain';
import { CORE_VIEW_CONTENT, CORE_VIEW_MAP, TypeDefinition } from '@hexly/web-entity';

/**
 * The two core Entity Types as the **web** registers them: the shared `defineType` declarations from
 * the domain (`CORE_NOTE_TYPE` / `CORE_HEXMAP_TYPE` — the exact constructor a bundled plugin's
 * declaration goes through) wearing the chrome only the web has. They then enter the
 * {@link TypeRegistry} through the same `register()` a plugin's do, so the core dogfoods the plugin
 * API end to end rather than merely resembling it (ADR-0048).
 *
 * `core.note` adds no payload beyond the `rich-content` base and so contributes only the
 * `core.view.content` View; `core.hexmap` adds the `hex-grid` payload and so also contributes
 * `core.view.map`. Neither declares Fields — a Note is its Content, a Hex Map its Content plus a grid.
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
