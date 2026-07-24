import { TranslationScope } from '@hexly/web-core';

/**
 * The Asset plugin's own copy (ADR-0049) — adds the `asset.*` scope to the app's vocabulary. Registered
 * eagerly by {@link providePluginAsset}: {@link ASSET_TYPE_DEFINITIONS}'s `labels` are transloco keys
 * rendered by the app's entity header, browser, and command palette, where no pipe of this lib is mounted
 * to trigger a lazy load.
 */
export const ASSET_TRANSLATIONS: TranslationScope = {
  scope: 'asset',
  loader: {
    en: () => import('./catalogs/en.json'),
    fr: () => import('./catalogs/fr.json'),
  },
};
