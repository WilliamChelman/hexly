import { TranslationScope } from '@hexly/web-core';

/**
 * dice-web's own copy (ADR-0049). Registered eagerly: the section label, the roll label, and the
 * invalid-expression hint are read imperatively from the {@link DiceCommands} Provider (a service),
 * where no pipe of this lib is guaranteed to trigger the load.
 */
export const DICE_TRANSLATIONS: TranslationScope = {
  scope: 'dice',
  loader: {
    en: () => import('./catalogs/en.json'),
    fr: () => import('./catalogs/fr.json'),
  },
};
