import { CORE_VIEW_DETAILS, ViewDefinition } from '@hexly/web-entity';
import { DetailsViewComponent } from './details-view.component';

/**
 * The app's own View registration (ADR-0048, ADR-0051, ADR-0067): the **Details View** alone — the
 * content and map Views left for their plugins, so `core.view.details` is the one View `apps/web` still
 * names, the fallback every Entity can open on. {@link EntityPage} registers it from the lazy entity
 * chunk, so {@link DetailsViewComponent}'s body never reaches the initial bundle.
 */
export const CORE_VIEW_DEFINITIONS: readonly ViewDefinition[] = [
  {
    // The Details View (ADR-0067): the fallback main content when an Entity affords no other View.
    // Core-registered here so it is always resolvable, without a plugin present.
    id: CORE_VIEW_DETAILS,
    labelKey: 'editorShell.view.details',
    // A centred reading column (ADR-0067): a wide viewport overlays the Dock Panel into the side
    // whitespace rather than shifting the column.
    layout: 'reading',
    component: DetailsViewComponent,
  },
];
