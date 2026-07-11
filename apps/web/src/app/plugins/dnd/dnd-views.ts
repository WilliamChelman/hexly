import { ViewDefinition } from '../../entity-types/view-definition';
import { DND_VIEW_STAT_BLOCK } from './dnd-types';
import { StatBlockView } from './stat-block-view';

/**
 * The D&D plugin's View registrations (#192) — bound to the {@link ViewRegistry} through the same
 * `register()` the core Views use, and from the same place: the lazy entity chunk, so a plugin's view
 * body never weighs down the initial bundle. `CORE_VIEW_DEFINITIONS` and this list are
 * indistinguishable to the registry, which is the point — the plugin API is the core's own API.
 */
export const DND_VIEW_DEFINITIONS: readonly ViewDefinition[] = [
  {
    id: DND_VIEW_STAT_BLOCK,
    labelKey: 'plugins.dnd.monster.view.statBlock',
    component: StatBlockView,
  },
];
