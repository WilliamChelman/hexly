import { EnvironmentProviders } from '@angular/core';
import { providePlugin } from '@hexly/web-entity';
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
  return providePlugin({
    id: PLUGIN_ID,
    types: DND_TYPE_DEFINITIONS,
    // The `dnd.stat-block` structured Field (ADR-0054); the prose `core.content` it also references is
    // the content plugin's.
    fields: [DND_STAT_BLOCK_FIELD],
    views: [
      {
        id: DND_VIEW_STAT_BLOCK,
        // The `dnd.stat-block` data-type's View, not the `dnd.monster` type's (ADR-0055): it renders
        // whichever stat-block Field placed it and takes its toggle label from that Field — so no toggle
        // copy of its own, mirroring the map View (ADR-0050).
        dataType: DND_STAT_BLOCK,
        // The copy naming the *kind* where a World Owner picks it, in the World Types editor (#201).
        dataTypeLabelKey: 'dnd.statBlock.dataType',
        loadComponent: () => import('./stat-block-view').then((m) => m.StatBlockView),
      },
    ],
    dataTypes: [STAT_BLOCK_DATA_TYPE],
    translations: DND_TRANSLATIONS,
  });
}
