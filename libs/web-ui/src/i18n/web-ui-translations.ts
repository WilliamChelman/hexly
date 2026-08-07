import { TranslationScope } from '@hexly/web-core';

/**
 * web-ui's own copy (ADR-0049). The lib is otherwise copy-free — a component takes its words as
 * already-translated inputs — so this holds only what belongs to a *shared control* rather than to any
 * one surface: the **Facet Token** grammar's own words, stated identically wherever the box is adopted.
 *
 * Eager: the box and its miss row render inside libs that provide no scope of their own.
 */
export const UI_TRANSLATIONS: TranslationScope = {
  scope: 'ui',
  loader: {
    en: () => import('./catalogs/en.json'),
    fr: () => import('./catalogs/fr.json'),
  },
};
