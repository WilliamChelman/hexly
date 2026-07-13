import { TranslationScope } from '@hexly/web-core';

/**
 * web-ui's own copy (ADR-0049). Registered eagerly: some controls translate imperatively for toasts,
 * where no pipe triggers the load.
 */
export const WEB_UI_TRANSLATIONS: TranslationScope = {
  scope: 'ui',
  loader: {
    en: () => import('./catalogs/en.json'),
    fr: () => import('./catalogs/fr.json'),
  },
};
