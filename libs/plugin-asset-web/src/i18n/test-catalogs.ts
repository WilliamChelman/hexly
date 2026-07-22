import { TestCatalogs } from '@hexly/web-core/testing';
import en from './catalogs/en.json';
import fr from './catalogs/fr.json';

/** The Asset plugin's real catalogs, keyed by load path, for any spec that renders its copy (ADR-0049). */
export const ASSET_TEST_CATALOGS: TestCatalogs = {
  'asset/en': en,
  'asset/fr': fr,
};
