import { DND_VIEW_DEFINITIONS } from '@hexly/plugin-dnd/web';
import { ViewDefinition } from '@hexly/web-entity';

/**
 * Every bundled plugin's View registrations, the sibling of {@link PLUGIN_TYPE_DEFINITIONS}. Split
 * from it by load time: these carry the view components, so the {@link EntityPage} registers them
 * from the lazy entity chunk and a plugin's view body stays off the initial bundle — as `core-views.ts`
 * does for the core's.
 */
export const PLUGIN_VIEW_DEFINITIONS: readonly ViewDefinition[] = [...DND_VIEW_DEFINITIONS];
