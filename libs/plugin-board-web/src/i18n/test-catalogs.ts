import { TestCatalogs } from '@hexly/web-core/testing';
import en from './catalogs/en.json';
import fr from './catalogs/fr.json';

/** The Board plugin's real catalogs, keyed by load path, for any spec that renders its copy (ADR-0049). */
export const BOARD_TEST_CATALOGS: TestCatalogs = {
  'board/en': en,
  'board/fr': fr,
};
