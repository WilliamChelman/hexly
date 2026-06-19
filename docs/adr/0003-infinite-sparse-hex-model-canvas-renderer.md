# Infinite sparse hex plane, Canvas 2D renderer, axial coordinates

A Hex Map is an **infinite plane**, not a bounded grid. A Hex exists *only* where the user has painted content; untouched coordinates are void with no record (see CONTEXT.md → Hex, Void). Storage is therefore a sparse map keyed by coordinate, not a dense array. Hexes are identified by **axial coordinates `(q, r)`** (signed ints, so the plane extends in every direction for free), with cube coordinates used transiently for distance/range/line algorithms. Orientation (pointy-top vs flat-top) is a per-map property, defaulting to pointy-top; the renderer is parameterized by it.

## Considered Options

A fixed or resizable finite grid was simpler to store and render, but was rejected because the user wanted unbounded worldbuilding ("I don't know how big my world is yet").

For rendering, SVG is ruled out by the infinite/virtualized requirement (a DOM node per hex doesn't scale). We chose **Canvas 2D, behind a `MapRenderer` interface** that draws only the visible viewport each frame, over WebGL/PixiJS. The bottleneck for a worldbuilding tool is editing UX and data, not frame rate; Canvas 2D reaches a usable editor far faster and handles tens of thousands of visible hexes when viewport-culled. The `MapRenderer` interface is the hedge: if a perf wall appears, a WebGL backend can be dropped in without touching the rest of the app.

## Consequences

- Everything downstream must assume sparsity: no dense iteration over "the grid", erasing a hex deletes its record, rendering paints a neutral void for absent coordinates.
- Premature WebGL is avoided, but very large *dense* maps with buttery zoom are not a v1 guarantee.
