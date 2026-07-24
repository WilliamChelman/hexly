/**
 * The Asset plugin's framework-free half (ADR-0065, ADR-0050) — the asset-ref value, the
 * `core.datatype.asset` **Structured Data Type**, and the `core.type.asset` Type declaration. Angular-free by
 * construction, so the API can import it. The Angular half lives behind `@hexly/plugin-asset/web`.
 */

export * from './lib';
