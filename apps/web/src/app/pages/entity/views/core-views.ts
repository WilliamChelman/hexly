import { CORE_VIEW_FIELDS, ViewDefinition } from '@hexly/web-entity';
import { GenericFieldView } from './generic-field-view.component';

/**
 * The app's own View registration (ADR-0048, ADR-0051): the **generic Field view** alone — the content
 * and map Views left for their plugins, so `core.view.fields` is the one View `apps/web` still names,
 * the fallback every Entity can open on. {@link EntityPage} registers it from the lazy entity chunk, so
 * {@link GenericFieldView}'s body never reaches the initial bundle.
 */
export const CORE_VIEW_DEFINITIONS: readonly ViewDefinition[] = [
  {
    // The generic Field View (ADR-0048, #187): renders user-defined and absent-plugin types.
    // Core-registered here so it is always resolvable as the fallback View, without a plugin present.
    id: CORE_VIEW_FIELDS,
    labelKey: 'editorShell.view.fields',
    component: GenericFieldView,
  },
];
