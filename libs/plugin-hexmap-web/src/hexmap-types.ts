import { PanelDefinition, PanelId, TypeDefinition } from '@hexly/web-entity';
import { CORE_VIEW_RICH_CONTENT } from '@hexly/plugin-content/web';
import { CORE_HEXMAP_TYPE, HEX_GRID_FIELD } from '@hexly/plugin-hexmap';

/** The Inspector Panel's id — the Map View's selection editor, moved off the map's editor-rail into the page Dock (ADR-0067). */
export const CORE_PANEL_MAP_INSPECTOR: PanelId = 'core.panel.map-inspector';

/** The Regions Panel's id — the Map View's region list, moved off the editor-rail into the page Dock (ADR-0067). */
export const CORE_PANEL_MAP_REGIONS: PanelId = 'core.panel.map-regions';

/**
 * The Map View's two *View-contributed* Dock Panels (ADR-0067) — the Inspector (the selection editor)
 * and the Regions list, listed on the map {@link ViewDefinition.panels} so the Dock draws their toggles
 * whenever the Map View is active and instantiates each with that running View's injector, reaching the
 * View-scoped {@link HexMapStore} the View provides. Both are `writeGate`d: the map is a read affordance
 * (pan/zoom), but editing a selection or managing regions leaves a read-only viewer's strip (ADR-0037).
 *
 * Both bodies are deferred (`loadComponent`) behind the same map chunk the View loads from — this
 * definition registers eagerly in the root injector, so naming either component would drag it onto the
 * initial bundle.
 *
 * The Inspector has no toggle copy of its own historically (it opened only on selection), so its label
 * reuses the empty-state title; the Regions toggle keeps the rail's label.
 */
export const MAP_INSPECTOR_PANEL: PanelDefinition = {
  id: CORE_PANEL_MAP_INSPECTOR,
  icon: 'pencil',
  labelKey: 'map.inspector.title',
  writeGate: true,
  loadComponent: () => import('./components/inspector.component').then((m) => m.InspectorComponent),
};

export const MAP_REGIONS_PANEL: PanelDefinition = {
  id: CORE_PANEL_MAP_REGIONS,
  icon: 'region',
  labelKey: 'map.regionsPanel.title',
  writeGate: true,
  loadComponent: () => import('./components/regions-panel.component').then((m) => m.RegionsPanelComponent),
};

/**
 * The Hex Map's Type as the web registers it (ADR-0050): the shared {@link CORE_HEXMAP_TYPE}
 * declaration — the id and the grid **Field of a Structured Data Type** the API reads too — plus the chrome only the
 * web has: the icon, the transloco copy, the graph colour, and the Views it affords.
 *
 * Views are ordered grid first, Content second, so a Hex Map opens on its map with a lore toggle beside
 * it. The map View is placed by its grid Field; the content View by id (ADR-0050, ADR-0051).
 *
 * Must import no component: {@link providePluginHexmap} seeds the root registry at startup, and the
 * canvas hangs off that provider's `loadComponent`.
 */
export const HEXMAP_TYPE_DEFINITIONS: readonly TypeDefinition[] = [
  {
    id: CORE_HEXMAP_TYPE.id,
    // References the prose and grid Fields by id (ADR-0054); `fields` kept for the World Types editor.
    fieldRefs: CORE_HEXMAP_TYPE.fieldRefs,
    icon: 'terrain',
    views: [{ field: HEX_GRID_FIELD.id }, CORE_VIEW_RICH_CONTENT],
    graphColorToken: '--color-gold',
    // A plugin ships translated copy, so its chrome is transloco keys (ADR-0049) — unlike a
    // user-defined type, whose every label is its one authored name (#191).
    labels: {
      name: 'map.hexmap.name',
      eyebrow: 'map.hexmap.eyebrow',
      titleLabel: 'map.hexmap.titleLabel',
      rename: 'map.hexmap.rename',
      editorLabel: 'map.hexmap.editorLabel',
      create: 'map.hexmap.create',
      untitled: 'map.hexmap.untitled',
    },
  },
];
