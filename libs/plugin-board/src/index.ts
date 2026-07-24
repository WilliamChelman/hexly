/**
 * The Board plugin's framework-free half (ADR-0050, #263) — the surface document, the element and
 * z-order helpers, the `core.datatype.board-surface` **Structured Data Type**, and the `core.type.board` Type
 * declaration. Angular-free by construction, so the API can import it. The Angular half lives behind
 * `@hexly/plugin-board/web`.
 */

export * from './lib';
