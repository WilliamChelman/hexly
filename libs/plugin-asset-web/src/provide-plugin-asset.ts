import { EnvironmentProviders, makeEnvironmentProviders } from '@angular/core';
import { LucideImage } from '@lucide/angular';
import { providePlugin } from '@hexly/web-entity';
import { lucideGlyph, provideIcons } from '@hexly/web-ui';
import { ASSET_DATA_TYPE, ASSET_FIELD, PLUGIN_ID } from '@hexly/plugin-asset';
import { ASSET_TRANSLATIONS } from './i18n/asset-translations';
import { ASSET_TYPE_DEFINITIONS } from './asset-types';

/**
 * The Asset plugin's one entry point into the app (ADR-0065, ADR-0048): `app.config.ts` names this and
 * nothing else.
 *
 * An Instance that omits it still opens existing Assets: `core.type.asset` becomes an unregistered type, so
 * the Entity affords the generic Field view and its asset-ref stays put as plain EntityDocument (the
 * absent-plugin degradation of ADR-0048). The mime-dispatching Asset renderer is its own ticket (ADR-0065);
 * until then the type opens on the generic view.
 */
export function providePluginAsset(): EnvironmentProviders {
  return makeEnvironmentProviders([
    provideIcons([lucideGlyph('asset', LucideImage)]),
    providePlugin({
      id: PLUGIN_ID,
      types: ASSET_TYPE_DEFINITIONS,
      // Declares the asset-ref Field (ADR-0054); the prose `core.field.content` it references is the content plugin's.
      fields: [ASSET_FIELD],
      dataTypes: [ASSET_DATA_TYPE],
      translations: ASSET_TRANSLATIONS,
    }),
  ]);
}
