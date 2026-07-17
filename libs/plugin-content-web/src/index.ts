/**
 * The Content plugin's Angular half (ADR-0051): its one composition entry point,
 * {@link providePluginContent} (the twin of `providePluginHexmap`), plus the light symbols the app and
 * the Public Link page bind eagerly — the shared {@link EntityNameResolver} and the right dock's panel
 * set. The editor drives the host's central store through `@hexly/web-entity`'s `ENTITY_SESSION`, the
 * same seam the Hex Map plugin uses; it declares no port of its own.
 *
 * Export nothing TipTap-bound: `app.config.ts` imports this barrel to compose the plugin, so anything
 * re-exported here ships on the initial bundle. The editor, its chrome, the content View, and its dock
 * are reachable only through the View's `loadComponent`, and so live in the content View's own chunk
 * (mirrors `@hexly/plugin-hexmap/web`). A spec wanting a dock component takes it from its own file.
 */
export { providePluginContent } from './provide-plugin-content';
export { CORE_VIEW_CONTENT } from './content-types';
export { EntityNameResolver } from './services/entity-name-resolver';
export { RIGHT_DOCK_PANELS, type RightPanel } from './services/right-dock';
