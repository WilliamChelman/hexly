import { TestCatalogs } from '@hexly/web-core/testing';
import en from './catalogs/en.json';
import fr from './catalogs/fr.json';
import collabEn from './collab-catalogs/en.json';
import collabFr from './collab-catalogs/fr.json';

/** web-entity's real catalogs, keyed by load path, for any spec that renders its copy (ADR-0049). */
export const WEB_ENTITY_TEST_CATALOGS: TestCatalogs = {
  'fields/en': en,
  'fields/fr': fr,
};

/** The collaboration & sharing scope's catalogs, for specs that render its copy (ADR-0049). */
export const COLLAB_TEST_CATALOGS: TestCatalogs = {
  'collab/en': collabEn,
  'collab/fr': collabFr,
};
