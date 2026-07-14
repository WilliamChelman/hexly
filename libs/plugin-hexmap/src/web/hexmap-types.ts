import { TypeDefinition } from '@hexly/web-entity';
import { CORE_VIEW_CONTENT } from '@hexly/plugin-content/web';
import { CORE_HEXMAP_TYPE, HEX_GRID_FIELD } from '../lib';

/**
 * The Hex Map's Type as the web registers it (ADR-0050): the shared {@link CORE_HEXMAP_TYPE}
 * declaration — the id and the grid **Structured Field** the API reads too — plus the chrome only the
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
    fields: CORE_HEXMAP_TYPE.fields,
    icon: 'terrain',
    views: [{ field: HEX_GRID_FIELD.key }, CORE_VIEW_CONTENT],
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
