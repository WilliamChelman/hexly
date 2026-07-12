import { ViewDefinition } from '@hexly/web-entity';
import { DND_VIEW_STAT_BLOCK } from './dnd-types';
import { StatBlockView } from './stat-block-view';

/**
 * The D&D plugin's View registrations (#192), bound to the `ViewRegistry` from the lazy entity chunk
 * so the view body stays off the initial bundle. Split from `dnd-types.ts` by load time, not concern:
 * only this half imports a component.
 */
export const DND_VIEW_DEFINITIONS: readonly ViewDefinition[] = [
  {
    id: DND_VIEW_STAT_BLOCK,
    labelKey: 'plugins.dnd.monster.view.statBlock',
    component: StatBlockView,
  },
];
