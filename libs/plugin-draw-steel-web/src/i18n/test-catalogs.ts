import { TestCatalogs } from '@hexly/web-core/testing';
import en from './catalogs/en.json';
import fr from './catalogs/fr.json';

/** The plugin's real catalogs, keyed by load path, for any spec that renders its copy (ADR-0049). */
export const DS_TEST_CATALOGS: TestCatalogs = {
  'drawSteel/en': en,
  'drawSteel/fr': fr,
};
