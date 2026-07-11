import { CORE_HEXMAP, CORE_NOTE } from '@hexly/domain';
import { TypeDefinition } from './type-definition';

/**
 * The two core Entity Types, registered with the {@link TypeRegistry} the same
 * way a bundled plugin would (`register()`), so the core dogfoods the type API
 * (ADR-0048). `core.note` adds no payload beyond the `rich-content` base;
 * `core.hexmap` adds the `hex-grid` payload and so affords the `map` surface.
 *
 * The label values are transloco keys (see `libs/web-core/src/i18n/catalogs`),
 * carried verbatim from the branches this registry replaced so the app reads
 * identically.
 */
export const CORE_TYPE_DEFINITIONS: readonly TypeDefinition[] = [
  {
    id: CORE_NOTE,
    icon: 'label',
    surfaces: ['note'],
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
    id: CORE_HEXMAP,
    icon: 'terrain',
    surfaces: ['map', 'note'],
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
