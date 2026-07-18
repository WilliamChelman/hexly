import { TranslationScope } from '@hexly/web-core';

/**
 * admin-web's own copy (ADR-0049). Must be registered eagerly: the route `title` (`admin.tabTitle`)
 * is resolved by the TitleStrategy before the lazy page — and any pipe inside it — has loaded.
 */
export const ADMIN_TRANSLATIONS: TranslationScope = {
  scope: 'admin',
  loader: {
    en: () => import('./catalogs/en.json'),
    fr: () => import('./catalogs/fr.json'),
  },
};
