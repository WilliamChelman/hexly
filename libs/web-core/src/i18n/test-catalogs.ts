import { TestCatalogs } from './transloco-testing';
import en from './catalogs/en.json';
import fr from './catalogs/fr.json';

/** web-core's real catalogs, keyed by load path, for any spec that renders its copy (ADR-0049). */
export const WEB_CORE_TEST_CATALOGS: TestCatalogs = {
  'core/en': en,
  'core/fr': fr,
};
