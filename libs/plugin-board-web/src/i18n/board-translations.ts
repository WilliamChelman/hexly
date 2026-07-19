import { TranslationScope } from '@hexly/web-core';

/**
 * The Board plugin's own copy (ADR-0049) — adds the `board.*` scope to the app's vocabulary.
 * Registered eagerly by {@link providePluginBoard}: {@link BOARD_TYPE_DEFINITIONS}'s `labels` are
 * transloco keys rendered by the app's entity header, browser, and command palette, where no pipe of
 * this lib is mounted to trigger a lazy load.
 */
export const BOARD_TRANSLATIONS: TranslationScope = {
  scope: 'board',
  loader: {
    en: () => import('./catalogs/en.json'),
    fr: () => import('./catalogs/fr.json'),
  },
};
