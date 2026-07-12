import { DND_VIEW_DEFINITIONS } from '@hexly/plugin-dnd/web';
import { ViewDefinition } from '@hexly/web-entity';

/**
 * Every bundled plugin's View registrations, the sibling of {@link PLUGIN_TYPE_DEFINITIONS}. Kept
 * apart from it because the split is by **load time**: these carry the view components, so — exactly
 * like the core's `core-views.ts` — the {@link EntityPage} registers them from the lazy entity chunk
 * and a plugin's view body never reaches the initial bundle.
 */
export const PLUGIN_VIEW_DEFINITIONS: readonly ViewDefinition[] = [...DND_VIEW_DEFINITIONS];
