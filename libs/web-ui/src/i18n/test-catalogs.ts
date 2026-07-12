import { TestCatalogs } from '@hexly/web-core/testing';
import en from './catalogs/en.json';
import fr from './catalogs/fr.json';

/** web-ui's real catalogs, keyed by load path, for any spec that renders its copy (ADR-0049). */
export const WEB_UI_TEST_CATALOGS: TestCatalogs = {
  'ui/en': en,
  'ui/fr': fr,
};
