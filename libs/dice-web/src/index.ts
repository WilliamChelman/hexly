/**
 * dice-web (issue #249): the pure, deterministic dice engine every roll surface
 * builds on. `parse` turns a Dice Expression into an AST or a typed error;
 * `evaluate` turns that AST into a Roll Result under a caller-supplied RNG. This
 * lib owns no UI and never persists a Roll (CONTEXT.md — Dice).
 */
export * from './dice';
export * from './parse';
export * from './evaluate';
