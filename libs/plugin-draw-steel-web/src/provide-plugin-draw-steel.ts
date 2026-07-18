import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { LucideSwords } from '@lucide/angular';
import { providePlugin } from '@hexly/web-entity';
import { lucideGlyph, provideIcons } from '@hexly/web-ui';
import { PLUGIN_ID, DS_STAT_BLOCK, DS_STAT_BLOCK_FIELD, STAT_BLOCK_DATA_TYPE } from '@hexly/plugin-draw-steel';
import { DS_TRANSLATIONS } from './i18n/draw-steel-translations';
import { DS_TYPE_DEFINITIONS, DS_VIEW_STAT_BLOCK } from './draw-steel-types';

/**
 * The Draw Steel plugin's one entry point into the app (ADR-0048), the sibling of `providePluginDnd`.
 *
 * The stat block is deferred because this provider runs in the root injector, where naming the class
 * would pull the view body onto the initial bundle. Its id and label still register at startup, so the
 * header can draw the view toggle; only the body waits for the first monster.
 */
export function providePluginDrawSteel(): EnvironmentProviders {
  return makeEnvironmentProviders([
    // The `swords` glyph the monster type wears (#242): a bundled plugin dresses its type in a Lucide
    // glyph web-ui's core vocabulary omits by registering it here, not by editing web-ui (ADR-0007).
    provideIcons([lucideGlyph('swords', LucideSwords)]),
    providePlugin({
      id: PLUGIN_ID,
      types: DS_TYPE_DEFINITIONS,
      // The `draw-steel.stat-block` structured Field (ADR-0054); the prose `core.content` it also
      // references is the content plugin's.
      fields: [DS_STAT_BLOCK_FIELD],
      views: [
        {
          id: DS_VIEW_STAT_BLOCK,
          // The `draw-steel.stat-block` data-type's View, not the `draw-steel.monster` type's (ADR-0055):
          // it renders whichever stat-block Field placed it and takes its toggle label from that Field —
          // so no toggle copy of its own, mirroring the map View (ADR-0050).
          dataType: DS_STAT_BLOCK,
          // The copy naming the *kind* where a World Owner picks it, in the World Types editor (#201).
          dataTypeLabelKey: 'drawSteel.statBlock.dataType',
          loadComponent: () => import('./components/stat-block-view.component').then((m) => m.StatBlockViewComponent),
        },
      ],
      dataTypes: [STAT_BLOCK_DATA_TYPE],
      translations: DS_TRANSLATIONS,
    }),
  ]);
}
