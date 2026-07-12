/**
 * The Hex Map plugin's Angular half (ADR-0050, #199): **one** provider, so the app composes the plugin
 * by naming {@link providePluginHexmap} in `app.config.ts` rather than importing its type's chrome, its
 * View, and its data-type piecemeal. Kept behind its own entry point so the framework-free half —
 * `@hexly/plugin-hexmap`, the half the API imports — drags in no Angular.
 *
 * Component-free by construction, as `plugin-dnd`'s barrel is: `app.config.ts` imports this file, so
 * anything exported here ships on the initial bundle. The canvas, its chrome, and the store behind
 * them are reachable only through the `loadComponent` inside the provider, and so live in the map
 * View's own chunk. A spec wanting the real store takes it from `@hexly/plugin-hexmap/testing`.
 */
export { providePluginHexmap } from './provide';
