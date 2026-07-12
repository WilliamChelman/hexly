import { TranslationScope } from '@hexly/web-core';

/**
 * web-entity's own copy (ADR-0049): what its Field controls speak, and the headings the generic
 * Field view prints around them. Registered eagerly — that view lives in the app, so no pipe inside
 * this lib is guaranteed to trigger the load.
 */
export const WEB_ENTITY_TRANSLATIONS: TranslationScope = {
  scope: 'fields',
  loader: {
    en: () => import('./catalogs/en.json'),
    fr: () => import('./catalogs/fr.json'),
  },
};
