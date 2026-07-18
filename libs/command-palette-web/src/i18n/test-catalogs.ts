import { TestCatalogs } from '@hexly/web-core/testing';
import en from './catalogs/en.json';
import fr from './catalogs/fr.json';

/** command-palette-web's real catalogs, keyed by load path, for any spec that renders its copy (ADR-0049). */
export const COMMAND_PALETTE_TEST_CATALOGS: TestCatalogs = {
  'commandPalette/en': en,
  'commandPalette/fr': fr,
};
