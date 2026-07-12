import { TranslationScope } from '@hexly/web-core';

/**
 * web-ui's own copy (ADR-0049), so a new shared control lands with its strings rather than a key in
 * someone else's catalog. Registered eagerly: these controls render on nearly every page, and some
 * translate imperatively for toasts, where no pipe triggers the load.
 */
export const WEB_UI_TRANSLATIONS: TranslationScope = {
  scope: 'ui',
  loader: {
    en: () => import('./catalogs/en.json'),
    fr: () => import('./catalogs/fr.json'),
  },
};
