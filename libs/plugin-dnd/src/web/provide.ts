import { EnvironmentProviders } from '@angular/core';
import { providePlugin } from '@hexly/web-entity';
import { DND_TRANSLATIONS } from '../i18n/dnd-translations';
import { DND_TYPE_DEFINITIONS, DND_VIEW_STAT_BLOCK } from './dnd-types';

/**
 * The D&D plugin's one entry point into the app (ADR-0048, #192): `app.config.ts` names this and
 * nothing else — the `dnd.monster` type reaches the root `TypeRegistry`, the stat block the
 * `ViewRegistry`, and `dnd.*` the app's vocabulary.
 *
 * The stat block is deferred because this provider runs in the root injector, where naming the class
 * would pull the view body onto the initial bundle. Its id and label still register at startup, so the
 * header can draw the view toggle; only the body waits for the first monster.
 */
export function providePluginDnd(): EnvironmentProviders {
  return providePlugin({
    types: DND_TYPE_DEFINITIONS,
    views: [
      {
        id: DND_VIEW_STAT_BLOCK,
        labelKey: 'dnd.monster.view.statBlock',
        loadComponent: () => import('./stat-block-view').then((m) => m.StatBlockView),
      },
    ],
    translations: DND_TRANSLATIONS,
  });
}
