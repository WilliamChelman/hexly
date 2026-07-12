import { TranslationScope } from '@hexly/web-core';

/**
 * The plugin's own copy (ADR-0049) — dropping the plugin in adds `dnd.*` to the app's vocabulary.
 * Registered eagerly: the type's chrome lives in {@link DND_MONSTER_TYPE}'s `labels` as transloco
 * keys, rendered by the app's command palette and entity header where no pipe of ours triggers the
 * scope's load.
 */
export const DND_TRANSLATIONS: TranslationScope = {
  scope: 'dnd',
  loader: {
    en: () => import('./catalogs/en.json'),
    fr: () => import('./catalogs/fr.json'),
  },
};
