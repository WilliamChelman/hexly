# Hexly

A web application for creating and editing hex maps for TTRPG games and worldbuilding. Maps are persisted to user accounts and can be shared.

## Language

**Hex Map**:
The top-level document a user creates and edits: a grid of hexes plus overlays and metadata. The unit of saving, ownership, and sharing.
_Avoid_: Map document, board, canvas

**Hex**:
A cell the user has given content to, stored at its coordinate. The map is an infinite plane, so a Hex exists *only* where painted — there is no bounded grid of pre-existing cells. Carries at most one terrain, plus optional content (e.g. a feature, a label).
_Avoid_: Cell, tile, square

**Void**:
A coordinate with no Hex record — untouched space on the infinite plane. Rendered as a neutral background; carries no data and costs no storage.
_Avoid_: Empty hex, blank, null tile

**Terrain**:
The base type/fill of a single hex (e.g. grassland, ocean, mountains). Exactly one per hex.
_Avoid_: Biome, ground, background

**Feature**:
A discrete piece of content placed on a hex, typically rendered as an icon (e.g. a settlement, a ruin, a point of interest).
_Avoid_: Icon, marker, token, object

**Overlay**:
A linear element that rides on hex edges or vertices rather than filling a hex — rivers, roads, borders.
_Avoid_: Line, path, connector

**Region**:
A named, colored grouping of hex coordinates with optional notes (e.g. "The Kingdom of Avalon", "The Whisperwood"). Regions overlap freely: a single hex may belong to many regions at once (political, geographic, situational). Distinct from Terrain (per-hex fill) and Feature (single icon).
_Avoid_: Area, zone, territory, group

**Note**:
Longer prose attached to an entity (Hex, Feature, Region, or the Hex Map), stored as Markdown and shown in a side panel when the entity is selected. Not drawn on the map. The lore, description, and secrets.
_Avoid_: Description, comment, annotation, lore

**Label**:
A free-positioned text element drawn on the map (a point + text + size + optional rotation), not snapped to the hex grid — used for cartographic typography like region or ocean names. Distinct from an entity's `name` field, which the renderer may draw but which is not a Label.
_Avoid_: Text, caption, title, annotation

## Sharing

**Owner**:
The user who created a Hex Map. Full control, including granting roles to others and managing the public link. Exactly one per map.
_Avoid_: Admin, creator

**Editor**:
A named user granted permission to edit a Hex Map. Edits are asynchronous and last-write-wins, guarded by the map's version (a stale save is rejected). No real-time co-editing.
_Avoid_: Collaborator, contributor

**Viewer**:
A named user granted read-only access to a Hex Map.
_Avoid_: Reader, guest

**Public Link**:
An unguessable, unlisted URL that grants read-only access to a Hex Map without an account. The way a world is shown to people outside the closed user set.
_Avoid_: Share link, public URL, share token

## Placement modes

Every piece of map content sits in exactly one of three placement modes:

- **Hex-locked** — snapped to a hex coordinate: Terrain, Feature.
- **Edge/vertex** — riding on the boundaries between hexes: Overlay (rivers, roads, borders).
- **Free-positioned** — at an arbitrary point, off the grid: Label.
