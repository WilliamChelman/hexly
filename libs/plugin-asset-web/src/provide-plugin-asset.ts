import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { LucideFile, LucideFileText, LucideImage, LucideMusic } from '@lucide/angular';
import { providePlugin } from '@hexly/web-entity';
import { lucideGlyph, provideIcons } from '@hexly/web-ui';
import { ASSET_DATA_TYPE, ASSET_FIELD, PLUGIN_ID } from '@hexly/plugin-asset';
import { ASSET_TRANSLATIONS } from './i18n/asset-translations';
import { ASSET_TYPE_DEFINITIONS, CORE_VIEW_ASSET } from './asset-types';

/**
 * The Asset plugin's one entry point into the app (ADR-0065, ADR-0048): `app.config.ts` names this and
 * nothing else.
 *
 * An Instance that omits it still opens existing Assets: `core.type.asset` becomes an unregistered type, so
 * the Entity affords the generic Field view and its asset-ref stays put as plain EntityDocument (the
 * absent-plugin degradation of ADR-0048).
 *
 * The Asset View is deferred (`loadComponent`): this runs in the root injector, so naming
 * {@link AssetViewComponent} eagerly would drag the reused TipTap Content editor onto the initial bundle;
 * its id and label register at startup so the header can draw the toggle before the body is fetched.
 */
export function providePluginAsset(): EnvironmentProviders {
  return makeEnvironmentProviders([
    // The icon-card glyphs the Asset View falls back to per kind (ADR-0065): `asset` (image) is the type's
    // own icon; the rest cover the non-image kinds that render as an icon card today.
    provideIcons([
      lucideGlyph('asset', LucideImage),
      lucideGlyph('asset-pdf', LucideFileText),
      lucideGlyph('asset-audio', LucideMusic),
      lucideGlyph('asset-file', LucideFile),
    ]),
    providePlugin({
      id: PLUGIN_ID,
      types: ASSET_TYPE_DEFINITIONS,
      // Declares the asset-ref Field (ADR-0054); the prose `core.field.content` it references is the content plugin's.
      fields: [ASSET_FIELD],
      views: [
        {
          id: CORE_VIEW_ASSET,
          // A Type's own View placed by id, so it carries its own toggle label (ADR-0048).
          labelKey: 'asset.view.label',
          loadComponent: () => import('./components/asset-view.component').then((m) => m.AssetViewComponent),
        },
      ],
      dataTypes: [ASSET_DATA_TYPE],
      translations: ASSET_TRANSLATIONS,
    }),
  ]);
}
