import { COMMAND_PALETTE_TEST_CATALOGS } from '@hexly/command-palette-web/testing';
import { CONTENT_EDITOR_TEST_CATALOGS } from '@hexly/plugin-content/testing';
import { DND_TEST_CATALOGS } from '@hexly/plugin-dnd/testing';
import {
  TestCatalogs,
  WEB_CORE_TEST_CATALOGS,
  provideTranslocoTesting as provideCatalogs,
} from '@hexly/web-core/testing';
import { WEB_ENTITY_TEST_CATALOGS } from '@hexly/web-entity/testing';
import { HEXMAP_TEST_CATALOGS } from '@hexly/plugin-hexmap/testing';
import { WEB_UI_TEST_CATALOGS } from '@hexly/web-ui/testing';
import en from '../i18n/catalogs/en.json';
import fr from '../i18n/catalogs/fr.json';

/** The app's own catalog — the copy of its pages and shell (ADR-0049). */
export const APP_TEST_CATALOGS: TestCatalogs = { en, fr } as TestCatalogs;

/**
 * Every catalog the app can render — its own plus each lib's scoped one (ADR-0049).
 * `overrides` win on collision.
 */
export function provideTranslocoTesting(...overrides: readonly TestCatalogs[]) {
  return provideCatalogs(
    APP_TEST_CATALOGS,
    WEB_CORE_TEST_CATALOGS,
    WEB_UI_TEST_CATALOGS,
    WEB_ENTITY_TEST_CATALOGS,
    COMMAND_PALETTE_TEST_CATALOGS,
    CONTENT_EDITOR_TEST_CATALOGS,
    HEXMAP_TEST_CATALOGS,
    DND_TEST_CATALOGS,
    ...overrides,
  );
}
