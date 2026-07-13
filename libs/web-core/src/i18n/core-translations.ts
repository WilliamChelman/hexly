import { TranslationScope } from './translation-scope';

/**
 * web-core's own copy (ADR-0049): the strings its services speak — today the one toast
 * {@link ActiveWorld} raises when a pin write fails. Must be registered eagerly by the app:
 * a service translates imperatively, with no pipe to trigger a lazy load.
 */
export const CORE_TRANSLATIONS: TranslationScope = {
  scope: 'core',
  loader: {
    en: () => import('./catalogs/en.json'),
    fr: () => import('./catalogs/fr.json'),
  },
};
