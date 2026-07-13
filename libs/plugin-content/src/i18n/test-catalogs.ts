import { TestCatalogs } from '@hexly/web-core/testing';
import en from './catalogs/en.json';
import fr from './catalogs/fr.json';

/** content-editor's real catalogs, keyed by load path, for any spec that renders its copy (ADR-0049). */
export const CONTENT_EDITOR_TEST_CATALOGS: TestCatalogs = {
  'editor/en': en,
  'editor/fr': fr,
};
