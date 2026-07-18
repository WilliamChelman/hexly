import { TranslationScope } from '@hexly/web-core';

/**
 * Registered eagerly: the type's chrome lives in {@link DS_TYPE_DEFINITIONS}'s `labels` as transloco
 * keys, rendered by the app's command palette and entity header where no pipe of ours triggers the
 * scope's load.
 */
export const DS_TRANSLATIONS: TranslationScope = {
  // Transloco camel-cases a scope for key lookup, so the plugin's copy answers under `drawSteel.*` keys
  // even though the plugin namespace is `draw-steel` (like the content plugin's `editor` scope, ADR-0049).
  scope: 'drawSteel',
  loader: {
    en: () => import('./catalogs/en.json'),
    fr: () => import('./catalogs/fr.json'),
  },
};
