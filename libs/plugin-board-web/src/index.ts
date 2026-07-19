/**
 * The Board plugin's Angular half (ADR-0050): the one provider, {@link providePluginBoard}, that
 * `app.config.ts` names. Kept behind its own entry point so the framework-free half —
 * `@hexly/plugin-board`, the half the API imports — drags in no Angular.
 *
 * Export nothing component-bound: `app.config.ts` imports this file, so anything exported here ships on
 * the initial bundle. The canvas, its chrome, and the store behind them are reachable only through the
 * `loadComponent` inside the provider, and so live in the board View's own chunk. A spec wanting the
 * real store takes it from `@hexly/plugin-board/testing`.
 */
export { providePluginBoard } from './provide-plugin-board';
