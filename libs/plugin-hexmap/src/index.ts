/**
 * The Hex Map plugin's framework-free half (ADR-0050) — the geometry, the grid document, the
 * `core.hex-grid` **Structured Data Type**, and the `core.hexmap` Type declaration. Angular-free
 * by construction, so the API can import it. The Angular half lives behind `@hexly/plugin-hexmap/web`.
 */

export * from './lib';
