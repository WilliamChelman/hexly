/**
 * The Entity contracts a lib depends on and the app binds (ADR-0048). Must stay component-free: the
 * root injector reads these tokens, so any view exported here would land on the initial bundle. Shared
 * controls belong in `@hexly/web-entity/controls`.
 */
export * from './lib/entity-session';
export * from './lib/entity-types';
export * from './lib/plugin';
export * from './lib/type-definition';
export * from './lib/user-type-views';
export * from './lib/view-definition';
export * from './lib/view-instance';
