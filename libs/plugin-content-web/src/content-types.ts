import { PanelDefinition, TypeDefinition, ViewId } from '@hexly/web-entity';
import { CORE_NOTE_TYPE } from '@hexly/plugin-content';

/** The Content View's id — the prose renderer the `core.datatype.rich-content` data-type contributes (ADR-0051). */
export const CORE_VIEW_RICH_CONTENT: ViewId = 'core.view.rich-content';

/** The Outline Panel's id — the Content View's heading-navigation list, moved off its private dock into the page Dock (ADR-0067). */
export const CORE_PANEL_OUTLINE = 'core.panel.outline';

/**
 * **Outline**, the first *View-contributed* Dock Panel (ADR-0067) — listed on the content View's
 * {@link ViewDefinition.panels}, so the Dock draws its toggle whenever the Content View is active and
 * instantiates it with that running View's injector, reaching the View-scoped {@link OutlineStore} the
 * View provides. Its body is deferred (`loadComponent`) behind the same content chunk the View loads
 * from — this definition registers eagerly in the root injector, so naming the component would drag it
 * onto the initial bundle.
 */
export const OUTLINE_PANEL: PanelDefinition = {
  id: CORE_PANEL_OUTLINE,
  icon: 'outline',
  labelKey: 'editor.outline.toggle',
  loadComponent: () => import('./components/outline-panel.component').then((m) => m.OutlinePanelComponent),
};

/**
 * `core.type.note` as the web registers it (ADR-0051): the shared {@link CORE_NOTE_TYPE} declaration plus the
 * chrome only the web has — icon, transloco copy, graph colour, and where its content View sits.
 *
 * It places the content View by id, so the toggle keys plain (`core.view.rich-content`) over its one prose
 * Field; a World type's *extra* prose Field places it by `{ field }` instead (ADR-0051). Imports no
 * component: {@link providePluginContent} defers the editor behind its `loadComponent`.
 */
export const CONTENT_TYPE_DEFINITIONS: readonly TypeDefinition[] = [
  {
    id: CORE_NOTE_TYPE.id,
    // References the prose Field by id (ADR-0054); `fields` kept for the World Types editor.
    fieldRefs: CORE_NOTE_TYPE.fieldRefs,
    icon: 'label',
    views: [CORE_VIEW_RICH_CONTENT],
    graphColorToken: '--color-ink-muted',
    // A plugin ships translated copy, so its chrome is its own `editor` scope keys (ADR-0049).
    labels: {
      name: 'editor.note.name',
      eyebrow: 'editor.note.eyebrow',
      titleLabel: 'editor.note.titleLabel',
      rename: 'editor.note.rename',
      editorLabel: 'editor.note.editorLabel',
      create: 'editor.note.create',
      untitled: 'editor.note.untitled',
    },
  },
];
