import { EnvironmentProviders } from '@angular/core';
import { CORE_VIEW_MAP, providePlugin } from '@hexly/web-entity';
import { CORE_HEX_GRID, HEX_GRID_DATA_TYPE } from '../lib';
import { HEXMAP_TRANSLATIONS } from '../i18n/hexmap-translations';
import { HEXMAP_TYPE_DEFINITIONS } from './hexmap-types';

/**
 * The Hex Map plugin's one entry point into the app (ADR-0048, ADR-0050, #199): `app.config.ts` names
 * this and nothing else. The `core.hexmap` type reaches the root `TypeRegistry` with its chrome, the
 * map View reaches the `ViewRegistry`, the `core.hex-grid` **Structured Field** data-type reaches the
 * set the domain validates and mints grids against, and `map.*` joins the app's vocabulary.
 *
 * It is the same call `providePluginDnd()` makes — the Hex Map is a bundled plugin, framework-free
 * half and all, so the plugin API is dogfooded by the feature that most tempts a special case.
 *
 * An Instance that omits it still opens existing Hex Maps: `core.hexmap` becomes an unregistered
 * type, so the Entity affords its Content and the generic Field view, and the grid stays put as plain
 * Metadata (the absent-plugin degradation of ADR-0048).
 *
 * The canvas is deferred because this provider runs in the root injector, where naming `MapView`
 * eagerly would drag the renderer, the tool palette, and the docks onto the initial bundle — which is
 * also why this file is the only one the app imports from the plugin's web half. The View's id and
 * label still register at startup, so the header can draw its toggle before the body is fetched.
 */
export function providePluginHexmap(): EnvironmentProviders {
  return providePlugin({
    types: HEXMAP_TYPE_DEFINITIONS,
    views: [
      {
        id: CORE_VIEW_MAP,
        // The `core.hex-grid` data-type's View, not the `core.hexmap` type's: it renders whichever
        // grid Field placed it, and takes its toggle's label from that Field — hence no copy of its
        // own (ADR-0050).
        dataType: CORE_HEX_GRID,
        loadComponent: () => import('./components/map-view').then((m) => m.MapView),
      },
    ],
    dataTypes: [HEX_GRID_DATA_TYPE],
    // Eager, unlike the lazy scope this catalog used to be: the type's chrome lives in
    // HEXMAP_TYPE_DEFINITIONS as transloco keys, rendered by the app's header, browser, and command
    // palette — where no pipe of ours is there to trigger the load (ADR-0049).
    translations: HEXMAP_TRANSLATIONS,
  });
}
