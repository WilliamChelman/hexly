/**
 * The graph drawing layer, shared by the two surfaces that draw Entities as nodes: the World Graph page
 * and the Local Graph Panel (ADR-0072). It lives here rather than beside the page because the Panel is
 * a core universal Panel of this lib (ADR-0067), and both surfaces must draw the same picture.
 */
export * from './graph-canvas.component';
export * from './graph-warm-pool';
export * from './graph-payload';
export * from './orphans';
export * from './select-labels';
