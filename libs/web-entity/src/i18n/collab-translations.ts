import { TranslationScope } from '@hexly/web-core';

/**
 * The collaboration & sharing scope (ADR-0049): owners, grants, members and the shared Entity
 * picker. Registered eagerly — these controls translate imperatively for toasts, where no pipe
 * triggers the load.
 */
export const COLLAB_TRANSLATIONS: TranslationScope = {
  scope: 'collab',
  loader: {
    en: () => import('./collab-catalogs/en.json'),
    fr: () => import('./collab-catalogs/fr.json'),
  },
};
