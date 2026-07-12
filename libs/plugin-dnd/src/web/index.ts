/**
 * The D&D plugin's Angular half: one provider, so the app composes the plugin by naming
 * {@link providePluginDnd} in `app.config.ts` rather than importing its types, views, and copy piecemeal.
 *
 * Component-free by construction — the stat block is reachable only through the `loadComponent` inside
 * the provider, so importing this barrel from the app's bootstrap cannot pull the view body onto the
 * initial bundle.
 */
export { providePluginDnd } from './provide';
export { DND_VIEW_STAT_BLOCK } from './dnd-types';
