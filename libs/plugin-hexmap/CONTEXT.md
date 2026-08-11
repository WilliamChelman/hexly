# Hex Map

The bundled plugin contributing the `core.type.hex-map` Entity type and its `core.datatype.hex-grid` surface — an infinite hex plane and the vocabulary of what sits on it. Builds on the **Platform** context (see [CONTEXT-MAP.md](../../CONTEXT-MAP.md)).

## Language

**Hex Map**:
An Entity carrying the `core.type.hex-map` type, whose grid Field (`core.datatype.hex-grid`) is an infinite sparse plane of hexes, overlays, regions, and labels. The hex-locked sibling of the free-positioned Board.
_Avoid_: Map document, board (the free-positioned sibling Entity), canvas

**Hex**:
A cell the user has given content to, stored at its coordinate — the plane is infinite, so a Hex exists _only_ where painted. Carries exactly one terrain, at most one feature, and an optional name.
_Avoid_: Cell, tile, square

**Void**:
A coordinate with no Hex record — untouched space on the infinite plane.
_Avoid_: Empty hex, blank, null tile

**Terrain**:
The base type/fill of a single hex (grassland, ocean, mountains). Exactly one per hex.
_Avoid_: Biome, ground, background

**Feature**:
A discrete piece of content placed on a hex, typically rendered as an icon (a settlement, a ruin).
_Avoid_: Icon, marker, token, object

**Overlay**:
A linear element riding hex edges or vertices rather than filling a hex — rivers, roads, borders.
_Avoid_: Line, path, connector

**Region**:
A named, colored grouping of hex coordinates with optional notes. Regions overlap freely: one hex may belong to many.
_Avoid_: Area, zone, territory, group

**Name**:
A short identifying title carried by a Map element — a Hex or a Region. Distinct from a Label (free typography) and from a linked Entity's own `name`.
_Avoid_: Title, caption, label

**Label**:
A free-positioned text element drawn on the map, not snapped to the hex grid — cartographic typography like region or ocean names.
_Avoid_: Text, caption, title, annotation

**Map element**:
A placed thing _within_ a Hex Map — a Hex, Feature, Region, or Label — selectable, movable, and (except a Label) able to carry an Entity Link.
_Avoid_: Entity, item, object

**Placement mode**:
Which of three ways a piece of map content sits: **hex-locked** (snapped to a coordinate — Terrain, Feature), **edge/vertex** (riding the boundaries between hexes — Overlay), or **free-positioned** (at an arbitrary point off the grid — Label).
_Avoid_: Layer, anchoring, snap mode

**Marquee**:
The Select Subtool that drags a rectangle to select every Hex and Label within it. Regions are not marquee-selectable.
_Avoid_: Rubber band, lasso, box select

**Erase**:
The Tool that deletes a whole Hex record, returning the coordinate to Void. Distinct from the Feature tool's Clear Subtool, which removes only the feature.
_Avoid_: Delete, clear, remove

**Regions panel**:
A list of every Region (empty ones included) plus a New Region action; selecting a Region here is equivalent to selecting it on the canvas. A write-gated Panel contributed by the Map View.
_Avoid_: Region legend, layers, list
