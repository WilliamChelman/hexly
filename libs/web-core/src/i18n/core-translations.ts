import { TranslationScope } from './translation-scope';

/**
 * web-core's own copy (ADR-0049). The lib is i18n plumbing, not a UI surface, so it owns exactly the
 * strings its services speak — today the one toast {@link ActiveWorld} raises when a pin write fails.
 * Registered eagerly by the app: a service translates imperatively, with no pipe to trigger a load.
 */
export const CORE_TRANSLATIONS: TranslationScope = {
  scope: 'core',
  loader: {
    en: () => import('./catalogs/en.json'),
    fr: () => import('./catalogs/fr.json'),
  },
};
