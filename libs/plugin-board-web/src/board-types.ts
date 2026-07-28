import { PanelDefinition, PanelId, TypeDefinition, ViewId } from '@hexly/web-entity';
import { CORE_VIEW_RICH_CONTENT } from '@hexly/plugin-content/web';
import { CORE_BOARD_TYPE, SURFACE_FIELD } from '@hexly/plugin-board';

/** The surface View's id — the renderer the `core.datatype.board-surface` data-type contributes (ADR-0050). */
export const CORE_VIEW_BOARD: ViewId = 'core.view.board';

/** The Inspector Panel's id — the Board View's selection editor, moved off the View's floating dock into the page Dock (ADR-0067). */
export const CORE_PANEL_BOARD_INSPECTOR: PanelId = 'core.panel.board-inspector';

/**
 * The Board View's one *View-contributed* Dock Panel (ADR-0067): the Inspector — the geometry/z-order
 * editor for the current selection — listed on the board {@link ViewDefinition.panels} so the Dock draws
 * its toggle whenever the Board View is active and instantiates it with that running View's injector,
 * reaching the View-scoped {@link BoardStore} the View provides. `writeGate`d: the board plane is a read
 * affordance (pan/zoom), but editing a selection leaves a read-only viewer's strip (ADR-0037), mirroring
 * the Map View's Inspector.
 *
 * The body is deferred (`loadComponent`) behind the same board chunk the View loads from — this
 * definition registers eagerly in the root injector, so naming the component would drag it onto the
 * initial bundle.
 *
 * The Inspector has no toggle copy of its own historically (it opened only on selection), so its label
 * reuses the empty-state title.
 */
export const BOARD_INSPECTOR_PANEL: PanelDefinition = {
  id: CORE_PANEL_BOARD_INSPECTOR,
  icon: 'pencil',
  labelKey: 'board.inspector.title',
  writeGate: true,
  loadComponent: () => import('./components/inspector.component').then((m) => m.InspectorComponent),
};

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
    graphColorToken: '--color-accent',
    // A plugin ships translated copy, so its chrome is transloco keys (ADR-0049) — unlike a
    // user-defined type, whose every label is its one authored name (#191).
    labels: {
      name: 'board.name',
      eyebrow: 'board.eyebrow',
      titleLabel: 'board.titleLabel',
      rename: 'board.rename',
      editorLabel: 'board.editorLabel',
      create: 'board.create',
      untitled: 'board.untitled',
    },
  },
];
