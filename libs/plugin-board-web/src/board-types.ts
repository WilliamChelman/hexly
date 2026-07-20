import { TypeDefinition, ViewId } from '@hexly/web-entity';
import { CORE_VIEW_RICH_CONTENT } from '@hexly/plugin-content/web';
import { CORE_BOARD_TYPE, SURFACE_FIELD } from '@hexly/plugin-board';

/** The surface View's id — the renderer the `core.datatype.board-surface` data-type contributes (ADR-0050). */
export const CORE_VIEW_BOARD: ViewId = 'core.view.board';

/**
 * The Board's Type as the web registers it (ADR-0050): the shared {@link CORE_BOARD_TYPE} declaration
 * — the id and the surface **Field of a Structured Data Type** the API reads too — plus the chrome only
 * the web has: the icon, the transloco copy, the graph colour, and the Views it affords.
 *
 * Views are ordered surface first, Content second, so a Board opens on its plane with a lore toggle
 * beside it — the surface View is the Board's **default** (user story 5). The surface View is placed by
 * its `core.field.surface` Field (`{ field }`), the content View by id (ADR-0050, ADR-0051).
 *
 * Must import no component: {@link providePluginBoard} seeds the root registry at startup, and the
 * canvas hangs off that provider's `loadComponent`.
 */
export const BOARD_TYPE_DEFINITIONS: readonly TypeDefinition[] = [
  {
    id: CORE_BOARD_TYPE.id,
    // References the prose and surface Fields by id (ADR-0054); `fields` kept for the World Types editor.
    fieldRefs: CORE_BOARD_TYPE.fieldRefs,
    icon: 'dashboard',
    views: [{ field: SURFACE_FIELD.id }, CORE_VIEW_RICH_CONTENT],
    graphColorToken: '--color-gold',
    // A plugin ships translated copy, so its chrome is transloco keys (ADR-0049) — unlike a
    // user-defined type, whose every label is its one authored name (#191).
    labels: {
      eyebrow: 'board.eyebrow',
      titleLabel: 'board.titleLabel',
      rename: 'board.rename',
      editorLabel: 'board.editorLabel',
      create: 'board.create',
      untitled: 'board.untitled',
    },
  },
];
