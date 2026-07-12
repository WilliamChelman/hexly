/**
 * The Hex Map plugin's framework-free half (ADR-0050) — the geometry, the grid document, the
 * `core.hex-grid` **Structured Field** data-type, and the `core.hexmap` Type declaration.
 *
 * Angular-free by construction, so the API imports it from `bundled-plugins.ts` exactly as it imports
 * `@hexly/plugin-dnd`, and gets grid validation and grid edge-harvesting with no map-specific code of
 * its own. The Angular half lives behind `@hexly/plugin-hexmap/web`.
 */

export * from './lib';
