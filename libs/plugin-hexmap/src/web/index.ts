/**
 * The Hex Map plugin's Angular half (ADR-0050): the canvas, its editing chrome, and the store the
 * map View edits the grid through. Kept behind its own entry point so the framework-free half —
 * `@hexly/plugin-hexmap`, the half the API imports — drags in no Angular.
 */

export * from './services/hexmap-store';
export * from './components/tool-palette';
export * from './components/map-canvas';
export * from './components/inspector';
export * from './components/regions-panel';
export * from './components/editor-rail';
export * from './components/map-view';
