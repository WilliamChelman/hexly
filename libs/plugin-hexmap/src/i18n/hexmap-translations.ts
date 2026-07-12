import { TranslationScope } from '@hexly/web-core';

/**
 * The Hex Map plugin's own copy (ADR-0049), and the one scope that stays lazy: every `map.*` reader lives under
 * {@link MapView}, which provides the scope, so the catalog is fetched only once a hex map is on
 * screen. Children inherit it through the element injector.
 */
export const HEXMAP_TRANSLATIONS: TranslationScope = {
  scope: 'map',
  loader: {
    en: () => import('./catalogs/en.json'),
    fr: () => import('./catalogs/fr.json'),
  },
};
