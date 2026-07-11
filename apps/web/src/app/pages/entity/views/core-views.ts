import { MapView } from '@hexly/web-map';
import {
  CORE_VIEW_CONTENT,
  CORE_VIEW_FIELDS,
  CORE_VIEW_MAP,
  ViewDefinition,
} from '../../../entity-types/view-definition';
import { ContentView } from './content-view';
import { GenericFieldView } from './generic-field-view';

/**
 * The two core View registrations, bound to the {@link ViewRegistry} the same way a
 * bundled plugin would register its own View (ADR-0048, *Views* amendment). Kept
 * here beside {@link ContentView} — not in the root `ViewRegistry` — so the heavy
 * view bodies (web-map, TipTap) load with the lazy entity chunk and never reach the
 * initial bundle. {@link EntityPage} registers these on construct. `MapView` ships
 * from web-map; `ContentView` (block editor + docks) is app-level.
 *
 * The toggle label keys are carried verbatim from the old inline `VIEWS` list so the
 * Map / Note buttons read identically (`editorShell.view.note` labels the content view).
 */
export const CORE_VIEW_DEFINITIONS: readonly ViewDefinition[] = [
  {
    id: CORE_VIEW_MAP,
    labelKey: 'editorShell.view.map',
    component: MapView,
  },
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
