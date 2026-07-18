import { TranslationScope } from '@hexly/web-core';

/**
 * command-palette-web's own copy (ADR-0049). Registered eagerly: the section labels and Command
 * copy are read from Providers (services) that live outside this lib, where no pipe of this lib is
 * guaranteed to trigger the load.
 */
export const COMMAND_PALETTE_TRANSLATIONS: TranslationScope = {
  scope: 'commandPalette',
  loader: {
    en: () => import('./catalogs/en.json'),
    fr: () => import('./catalogs/fr.json'),
  },
};
