import { TranslationScope } from '@hexly/web-core';

/**
 * web-entity's own copy (ADR-0049). Must be registered eagerly: the generic Field view lives in the
 * app, so no pipe inside this lib is guaranteed to trigger the load.
 */
export const WEB_ENTITY_TRANSLATIONS: TranslationScope = {
  scope: 'fields',
  loader: {
    en: () => import('./catalogs/en.json'),
    fr: () => import('./catalogs/fr.json'),
  },
};
