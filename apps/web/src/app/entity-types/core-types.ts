import { TypeDefinition } from './type-definition';

/**
 * The two core Entity Types, registered with the {@link TypeRegistry} the same
 * way a bundled plugin would (`register()`), so the core dogfoods the type API
 * (ADR-0048). `note` adds no payload beyond the Content base; `hexmap` adds the
 * hex grid and so affords the `map` surface.
 *
 * The label values are transloco keys (see `libs/web-core/src/i18n/catalogs`),
 * carried verbatim from the branches this registry replaced so the app reads
 * identically.
 */
export const CORE_TYPE_DEFINITIONS: readonly TypeDefinition[] = [
  {
    id: 'note',
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
    id: 'hexmap',
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
