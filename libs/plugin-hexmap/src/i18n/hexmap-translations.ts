import { TranslationScope } from '@hexly/web-core';

/**
 * The Hex Map plugin's own copy (ADR-0049) — adds `map.*` to the app's vocabulary. Registered
 * eagerly by {@link providePluginHexmap}: {@link HEXMAP_TYPE_DEFINITIONS}'s `labels` are transloco
 * keys rendered by the app's entity header, browser, and command palette, where no pipe of this lib
 * is mounted to trigger a lazy load.
 */
export const HEXMAP_TRANSLATIONS: TranslationScope = {
  scope: 'map',
  loader: {
    en: () => import('./catalogs/en.json'),
    fr: () => import('./catalogs/fr.json'),
  },
};
