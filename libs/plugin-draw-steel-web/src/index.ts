/**
 * Component-free by construction: the stat block is reachable only through the `loadComponent` inside
 * {@link providePluginDrawSteel}, so importing this barrel from the app's bootstrap cannot pull the view
 * body onto the initial bundle.
 */
export { providePluginDrawSteel } from './provide-plugin-draw-steel';
export { DS_VIEW_STAT_BLOCK } from './draw-steel-types';
