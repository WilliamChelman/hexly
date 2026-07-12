/**
 * The shared Field control: the one data-type-appropriate editor every surface that edits a typed
 * Field reuses — the generic Field view, the create dialog's required-Field prompt, and a plugin's
 * bespoke view (the D&D stat block's slots).
 *
 * It sits behind its own entry point, apart from the contracts in the main barrel, for the reason
 * `@hexly/web-entity/i18n` does: the root injector reaches the main barrel (the `TypeRegistry` reads
 * its tokens), so a component exported from *there* would ship on the initial bundle whether or not
 * anything on screen renders it.
 */
export { FieldControl } from './field-control';
