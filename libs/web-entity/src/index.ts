/**
 * The Entity contracts a lib depends on and the app binds (ADR-0048): the central store's token, the
 * type/view registries' shapes, and the plugin seam. Component-free by construction — the shared
 * controls live behind `@hexly/web-entity/controls`, so the root injector reading these tokens never
 * drags a view body onto the initial bundle.
 */
export * from './lib/entity-session';
export * from './lib/entity-types';
export * from './lib/plugin';
export * from './lib/type-definition';
export * from './lib/user-type-views';
export * from './lib/view-definition';
export * from './lib/view-instance';
