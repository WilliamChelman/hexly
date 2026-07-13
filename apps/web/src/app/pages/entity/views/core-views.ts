import { CORE_VIEW_CONTENT, CORE_VIEW_FIELDS, ViewDefinition } from '@hexly/web-entity';
import { ContentView } from './content-view';
import { GenericFieldView } from './generic-field-view';

/**
 * The core View registrations, bound to the {@link ViewRegistry} the same way a bundled plugin
 * registers its own (ADR-0048). Kept here beside {@link ContentView} — not in the root
 * `ViewRegistry` — so the heavy view bodies (TipTap) load with the lazy entity chunk and never
 * reach the initial bundle. {@link EntityPage} registers these on construct.
 *
 * Neither belongs to a Type: {@link ContentView} renders the base body every Entity has, and
 * {@link GenericFieldView} is the fallback for a type with no registered view.
 */
export const CORE_VIEW_DEFINITIONS: readonly ViewDefinition[] = [
  {
    id: CORE_VIEW_CONTENT,
    labelKey: 'editorShell.view.note',
    component: ContentView,
  },
  {
    // The generic Field View (ADR-0048, #187): renders user-defined and absent-plugin types.
    // Core-registered here so it is always resolvable as the fallback View, without a plugin present.
    id: CORE_VIEW_FIELDS,
    labelKey: 'editorShell.view.fields',
    component: GenericFieldView,
  },
];
