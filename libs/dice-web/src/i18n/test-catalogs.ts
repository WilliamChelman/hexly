import { TestCatalogs } from '@hexly/web-core/testing';
import en from './catalogs/en.json';
import fr from './catalogs/fr.json';

/** dice-web's real catalogs, keyed by load path, for any spec that renders its copy (ADR-0049). */
export const DICE_TEST_CATALOGS: TestCatalogs = {
  'dice/en': en,
  'dice/fr': fr,
};
