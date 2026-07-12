import { TranslationScope } from '@hexly/web-core';

/**
 * The editor's own copy — slash menu, pickers, formatting menu, entity-link chrome (ADR-0049).
 *
 * Registered eagerly rather than on {@link ContentEditor}, because two readers sit outside that
 * component's injector: Tiptap node views are mounted with `createComponent(...)`, which hands
 * {@link CalloutView} only the EnvironmentInjector, and the app's references panel renders
 * `editor.entityLink.dangling` outside the editor entirely.
 */
export const CONTENT_EDITOR_TRANSLATIONS: TranslationScope = {
  scope: 'editor',
  loader: {
    en: () => import('./catalogs/en.json'),
    fr: () => import('./catalogs/fr.json'),
  },
};
