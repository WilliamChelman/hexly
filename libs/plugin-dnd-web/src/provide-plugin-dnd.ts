import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { LucideSkull } from '@lucide/angular';
import { providePlugin } from '@hexly/web-entity';
import { lucideGlyph, provideIcons } from '@hexly/web-ui';
import { PLUGIN_ID, DND_STAT_BLOCK, DND_STAT_BLOCK_FIELD, STAT_BLOCK_DATA_TYPE } from '@hexly/plugin-dnd';
import { DND_TRANSLATIONS } from './i18n/dnd-translations';
import { DND_TYPE_DEFINITIONS, DND_VIEW_STAT_BLOCK } from './dnd-types';

/**
 * The D&D plugin's one entry point into the app (ADR-0048).
 *
 * The stat block is deferred because this provider runs in the root injector, where naming the class
 * would pull the view body onto the initial bundle. Its id and label still register at startup, so the
 * header can draw the view toggle; only the body waits for the first monster.
 */
export function providePluginDnd(): EnvironmentProviders {
  return makeEnvironmentProviders([
    // The `skull` glyph the monster type wears (#192): a bundled plugin dresses its type in a Lucide
    // glyph web-ui's core vocabulary omits by registering it here, not by editing web-ui (ADR-0007).
    provideIcons([lucideGlyph('skull', LucideSkull)]),
    providePlugin({
      id: PLUGIN_ID,
      types: DND_TYPE_DEFINITIONS,
      // The `dnd.datatype.stat-block` structured Field (ADR-0054); the prose `core.field.content` it also references is
      // the content plugin's.
      fields: [DND_STAT_BLOCK_FIELD],
      views: [
        {
          id: DND_VIEW_STAT_BLOCK,
          // The `dnd.datatype.stat-block` data-type's View, not the `dnd.type.monster` type's (ADR-0055): it renders
          // whichever stat-block Field placed it and takes its toggle label from that Field — so no toggle
          // copy of its own, mirroring the map View (ADR-0050).
          dataType: DND_STAT_BLOCK,
          // The copy naming the *kind* where a World Owner picks it, in the World Types editor (#201).
          dataTypeLabelKey: 'dnd.statBlock.dataType',
          loadComponent: () => import('./components/stat-block-view.component').then((m) => m.StatBlockViewComponent),
        },
      ],
      dataTypes: [STAT_BLOCK_DATA_TYPE],
      translations: DND_TRANSLATIONS,
    }),
  ]);
}
