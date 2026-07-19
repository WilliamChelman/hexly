/**
 * The Board plugin's framework-free half (ADR-0050, #263) — the surface document, the element and
 * z-order helpers, the `core.board-surface` **Structured Data Type**, the pure Embed cycle/depth
 * resolution, and the `core.board` Type declaration. Angular-free by construction, so the API can import
 * it. The Angular half lives behind `@hexly/plugin-board/web`.
 */

export * from './lib';
