import { TestCatalogs } from '@hexly/web-core/testing';
import en from './catalogs/en.json';
import fr from './catalogs/fr.json';

/** admin-web's real catalogs, keyed by load path, for any spec that renders its copy (ADR-0049). */
export const ADMIN_TEST_CATALOGS: TestCatalogs = {
  'admin/en': en,
  'admin/fr': fr,
};
