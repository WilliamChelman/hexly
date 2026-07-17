/**
 * The shared Field control, behind its own entry point: the root injector reaches the main barrel (the
 * `TypeRegistry` reads its tokens), so a component exported from there would ship on the initial bundle
 * whether or not anything on screen renders it.
 */
export { FieldControl } from './field-control.component';
