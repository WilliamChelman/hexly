import { CORE_VIEW_CONTENT, CORE_VIEW_MAP, TypeDefinition } from '@hexly/web-entity';
import { CORE_HEXMAP_TYPE } from '../lib';

/**
 * The Hex Map's Type as the web registers it (ADR-0050, #199): the shared {@link CORE_HEXMAP_TYPE}
 * declaration — the id and the grid **Structured Field** the API reads too — plus the chrome only the
 * web has: the icon, the transloco copy, the graph colour, and the Views it affords.
 *
 * It affords the map View then the Content view, so a Hex Map still opens on its map (the primary
 * type's first View) with its lore one toggle away. It contributes no generic Field View — shipping a
 * bespoke one is what the plugin's code buys, and a grid is not a form row.
 *
 * Component-import-free, so {@link providePluginHexmap} can seed the root registry at startup; the
 * canvas itself hangs off that provider's `loadComponent`.
 */
export const HEXMAP_TYPE_DEFINITIONS: readonly TypeDefinition[] = [
  {
    id: CORE_HEXMAP_TYPE.id,
    fields: CORE_HEXMAP_TYPE.fields,
    icon: 'terrain',
    views: [CORE_VIEW_MAP, CORE_VIEW_CONTENT],
    graphColorToken: '--color-gold',
    // A plugin ships translated copy, so its chrome is transloco keys (ADR-0049) — unlike a
    // user-defined type, whose every label is its one authored name (#191).
    labels: {
      eyebrow: 'map.hexmap.eyebrow',
      titleLabel: 'map.hexmap.titleLabel',
      rename: 'map.hexmap.rename',
      editorLabel: 'map.hexmap.editorLabel',
      create: 'map.hexmap.create',
      untitled: 'map.hexmap.untitled',
    },
  },
];
