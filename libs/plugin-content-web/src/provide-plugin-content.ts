import { EnvironmentProviders } from '@angular/core';
import { providePlugin } from '@hexly/web-entity';
import { CONTENT_FIELD, CORE_RICH_CONTENT, PLUGIN_ID, RICH_CONTENT_DATA_TYPE } from '@hexly/plugin-content';
import { CONTENT_EDITOR_TRANSLATIONS } from './i18n/content-editor-translations';
import { CONTENT_TYPE_DEFINITIONS, CORE_VIEW_RICH_CONTENT, OUTLINE_PANEL } from './content-types';

/**
 * The Content plugin's one entry point into the app (ADR-0048, ADR-0051): `app.config.ts` names this
 * beside `providePluginHexmap()` and `providePluginDnd()`. Omit it, and `core.type.note` is unregistered —
 * the Entity affords the generic Field view alone (the absent-plugin degradation of ADR-0051).
 *
 * The View is deferred (`loadComponent`) because this runs in the root injector, where naming
 * {@link ContentView} eagerly would drag TipTap onto the initial bundle; its id and labels register at
 * startup so the header can draw the toggle before the body is fetched.
 */
export function providePluginContent(): EnvironmentProviders {
  return providePlugin({
    id: PLUGIN_ID,
    types: CONTENT_TYPE_DEFINITIONS,
    // Owns the prose Field (ADR-0054); other plugins' types reference it by id.
    fields: [CONTENT_FIELD],
    views: [
      {
        id: CORE_VIEW_RICH_CONTENT,
        // The `core.datatype.rich-content` data-type's View: it renders whichever prose Field placed it, reading
        // that Field's key from `VIEW_FIELD_KEY` (ADR-0051).
        dataType: CORE_RICH_CONTENT,
        // Toggle label when a Type places this View by id; a `{ field }` placement uses the Field's label.
        labelKey: 'editor.view.content',
        // Names the kind in the World Types picker (#201).
        dataTypeLabelKey: 'editor.dataType.richContent',
        // The View contributes its Outline to the page Dock (ADR-0067): declared, so the Dock draws the
        // toggle synchronously before this View's body is fetched, and hosts the Panel with the View's injector.
        panels: [OUTLINE_PANEL],
        loadComponent: () => import('./components/content-view.component').then((m) => m.ContentViewComponent),
      },
    ],
    dataTypes: [RICH_CONTENT_DATA_TYPE],
    // Eager (ADR-0049): the chrome and slash-menu copy are keys the app renders where no pipe of ours loads them.
    translations: CONTENT_EDITOR_TRANSLATIONS,
  });
}
