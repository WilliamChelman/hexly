# Board

The bundled plugin contributing the `core.type.board` Entity type and its `core.datatype.board-surface` — a free-positioned 2D surface, the sibling of the Hex Map. Builds on the **Platform** context (see [CONTEXT-MAP.md](../../CONTEXT-MAP.md)).

## Language

**Board**:
An Entity carrying the `core.type.board` type — a free-positioned 2D worldbuilding surface, the sibling of the Hex Map, whose surface Field (`core.datatype.board-surface`) holds Board Elements.
_Avoid_: Canvas (informal gesture-surface sense only), board as a Hex Map synonym (retired), scene, collage, whiteboard

**Board Surface**:
The `core.datatype.board-surface` Structured Data Type — an infinite 2D plane, panned and zoomed by a camera, holding a z-ordered set of Board Elements.
_Avoid_: Canvas, board (bare), grid (the Hex Map's), plane

**Board Element**:
A placed thing on a Board Surface — geometry plus an explicit z-order. Three kinds today: an Image, an Embed, and a Text Block; the interactive kinds **arm** on a click into them, one at a time.
_Avoid_: Item, node, card (the Embed's fallback rendering), widget, shape

**Image**:
A Board Element that displays an Asset's bytes by capability link — _decor_, always static, cheap in quantity. Distinct from an Embed of an Asset (a reference with presence).
_Avoid_: Picture, photo, media, sprite

**Embed**:
A Board Element that renders another Entity inline by full live transclusion of a chosen View — an Entity Link that degrades to a card preview past the depth limit or when its View cannot render.
_Avoid_: Transclusion (the mechanism, not the element), card (the fallback rendering), portal, inset, iframe

**Text Block**:
A Board Element holding rich text authored on the surface, edited with the same editor as an Entity's Content. Distinct from a Label (the map's minimal typography).
_Avoid_: Label, note, sticky, caption, text box
