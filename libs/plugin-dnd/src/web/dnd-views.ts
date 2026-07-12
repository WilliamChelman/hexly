import { ViewDefinition } from '@hexly/web-entity';
import { DND_VIEW_STAT_BLOCK } from './dnd-types';
import { StatBlockView } from './stat-block-view';

/**
 * The D&D plugin's View registrations (#192) — bound to the `ViewRegistry` through the same
 * `register()` the core Views use, and from the same place: the lazy entity chunk, so a plugin's view
 * body never weighs down the initial bundle. Kept apart from `dnd-types.ts` because the split is by
 * **load time**, not by concern: only this half pulls in a component.
 */
export const DND_VIEW_DEFINITIONS: readonly ViewDefinition[] = [
  {
    id: DND_VIEW_STAT_BLOCK,
    labelKey: 'plugins.dnd.monster.view.statBlock',
    component: StatBlockView,
  },
];
