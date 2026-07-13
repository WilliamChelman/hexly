/**
 * Component-free by construction: the stat block is reachable only through the `loadComponent` inside
 * {@link providePluginDnd}, so importing this barrel from the app's bootstrap cannot pull the view
 * body onto the initial bundle.
 */
export { providePluginDnd } from './provide';
export { DND_VIEW_STAT_BLOCK } from './dnd-types';
