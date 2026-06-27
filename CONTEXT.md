# Hexly

A web application for TTRPG worldbuilding: authoring interlinked **Entities** — prose pages and hex maps — persisted to user accounts and shared.

## Entities

**Entity**:
The top-level thing a user creates, owns, and shares. Carries an `id`, a `name`, a `type`, `tags`, created/modified timestamps, and a rich-text **Content** body. A **Hex Map** is one kind of Entity. The unit of ownership, sharing, and saving.
_Avoid_: Document, page, record, object

**Entity Type**:
A closed, code-known enum that decides an Entity's shape: `note` (Content only) and `hexmap` (Content plus a hex grid). User- and plugin-defined types are a long-term goal, not a launch concept.
_Avoid_: Kind, category, class

**Content**:
The rich-text body every Entity carries — the result of block-based editing (TipTap; see ADR-0019). Stored as an opaque, format-tagged snapshot the domain never parses, so the editor can change without touching the Entity model. Replaces the old per-element "Note".
_Avoid_: Body, rich text, document, prose

**Tag**:
A free-text label on an Entity, for flavour and informal grouping (e.g. "deity", "ruined", "northern reach"). Carries no behaviour; distinct from the structured Entity Type.
_Avoid_: Keyword, category, label

**Entity Link**:
An optional reference to an Entity by id, from either a Map element (a Hex, Feature, or Region — not a Label, set via the Inspector) or inline within another Entity's Content (prose, inserted via `@` or the link picker): e.g. a settlement Feature pointing at the town's `note`, or a sentence in one note linking to another `hexmap`. A link to a missing or inaccessible Entity renders non-navigable — a Content link shows its last-known name as a dangling label — rather than erroring; ids are not referentially enforced. A Content link may carry an optional Link Descriptor.
_Avoid_: Reference, relation, backlink

**Link Descriptor**:
An optional free-text label on a Content Entity Link, characterising the relationship it expresses (e.g. "spouse", "rival", "capital of"). Like a Tag, but on a link rather than an Entity: carries no behaviour, one per link. A one-way annotation — it does not imply a reciprocal link on the target.
_Avoid_: Relationship, relation, role, type

**Map element**:
A placed thing *within* a Hex Map — a Hex, Feature, Region, or Label — that can be selected and moved, and (except a Label) can carry an Entity Link. The in-map counterpart to a top-level Entity. (Formerly called "entity" informally; renamed to free that word for the top-level type.)
_Avoid_: Entity, item, object

## Language

**Hex Map**:
An **Entity** of type `hexmap`: its Content (lore) plus a grid of hexes, overlays, regions, and labels. The grid is an infinite sparse plane — a Hex exists only where painted (ADR-0003). Ownership, sharing, and saving are properties of the Entity, not the grid.
_Avoid_: Map document, board, canvas

**Hex**:
A cell the user has given content to, stored at its coordinate. The map is an infinite plane, so a Hex exists *only* where painted — there is no bounded grid of pre-existing cells. Carries exactly one terrain, plus optional content: at most one feature and an optional name.
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
An Entity of type `note`: a prose worldbuilding page (a character, a faction, a place, a bit of history) whose substance is its Content. The lore, description, and secrets — now a first-class Entity that Map elements link to, not text attached to a single Map element.
_Avoid_: Description, comment, annotation, lore

**Name**:
A short identifying title carried by a Map element — a Hex (e.g. a village's name) or a Region. On a Hex it is optional, and only a painted Hex can hold one; it travels with the Hex's content when moved or swapped. The renderer draws it minimally, anchored to the hex. Distinct from a Label (free, hand-placed typography) and from a linked Entity's own `name`.
_Avoid_: Title, caption, label

**Label**:
A free-positioned text element drawn on the map (a point + text + size + optional rotation), not snapped to the hex grid — used for cartographic typography like region or ocean names. Distinct from an entity's `name` field, which the renderer may draw but which is not a Label.
_Avoid_: Text, caption, title, annotation

## Worlds

**World**:
A lightweight container record that groups Entities for a single campaign or setting. Not an Entity type — it lives outside the entity model. Every Entity belongs to exactly one World (`world_id NOT NULL`). Carries a `name`, an `owner_id`, and a `home_entity_id`.
_Avoid_: Space, container, campaign

**Home Entity**:
A `note` Entity auto-created when a World is created, designated by `worlds.home_entity_id`. Serves as the World's landing page. Cannot be deleted and cannot be moved to another World.
_Avoid_: World page, index, overview

**World Owner**:
The user who created the World. Full control over membership, roles, and the public link. Exactly one per World.
_Avoid_: Admin, GM (user vocabulary, not system vocabulary)

**Contributor**:
A named user granted the ability to create Entities inside a World (and own what they create) and to read all `shared` Entities. Cannot edit Entities they do not own unless granted entity-level Editor access separately.
_Avoid_: Editor, member, player

**World Viewer**:
A named user (or public link holder) granted read-only access to all `shared` Entities in a World.
_Avoid_: Reader, guest, spectator

**World Public Link**:
An unguessable, unlisted URL that grants World Viewer access to all `shared` Entities in a World without an account.
_Avoid_: Share link, invite link

## Sharing

Sharing is per **World** (ADR-0024). A World's sharing cascades to all `shared` Entities within it. Entity-level Editor/Viewer grants (ADR-0004) remain available for finer-grained control on top.

**Entity Visibility**:
A two-value field on every Entity: `private` (default) or `shared`. A `private` Entity is accessible only to its Owner and any entity-level Editor/Viewer grants. A `shared` Entity is accessible to all World members (Contributor, World Viewer, World Public Link holders). Per-user visibility is deferred.
_Avoid_: Published, public, visible

**Owner**:
The user who created an Entity. Full control, including granting entity-level roles and managing entity-level access. Exactly one per Entity.
_Avoid_: Admin, creator

**Editor**:
A named user granted permission to edit a specific Entity. Edits are asynchronous and last-write-wins, guarded by the Entity's version (a stale save is rejected). Real-time co-editing is deferred, not precluded (ADR-0019).
_Avoid_: Collaborator, contributor

**Viewer**:
A named user granted read-only access to a specific Entity.
_Avoid_: Reader, guest

**Public Link**:
An unguessable, unlisted URL that grants read-only access to a specific Entity without an account. Distinct from the World Public Link, which covers all `shared` Entities in a World.
_Avoid_: Share link, public URL, share token

**EntityView**:
Which editor surface is currently showing for an Entity that has multiple surfaces — the hex `'map'` (grid) or the `'note'` (Content body). Mirrored to the URL `view` param so a refresh or shared link lands on the correct surface. Session-only state, never part of the Entity document. Applies only to `hexmap` Entities; Notes have a single surface.
_Avoid_: Mode, surface, panel, view mode

## Placement modes

Every piece of map content sits in exactly one of three placement modes:

- **Hex-locked** — snapped to a hex coordinate: Terrain, Feature.
- **Edge/vertex** — riding on the boundaries between hexes: Overlay (rivers, roads, borders).
- **Free-positioned** — at an arbitrary point, off the grid: Label.

## Editing tools

**Tool**:
A top-level editing mode armed in the palette — Select, Terrain, Feature, Label, Erase. Exactly one is armed at a time, and a canvas gesture applies it. A map opens armed with Select (its Pick Subtool). Region is *not* a palette Tool: Regions are created in the Regions panel and their membership is painted via the Inspector's Add/Remove brush (ADR-0012).
_Avoid_: Mode, brush, instrument

**Subtool**:
A mutually-exclusive variant *within* a Tool — the Terrain tool's individual terrains, the Feature tool's individual features (and its Clear variant), and the Select tool's **Pick** and **Marquee**. Tools that have Subtools remember the last one used for the session. Label and Erase have no Subtools.
_Avoid_: Sub-mode, option, variant

**Select**:
The one non-destructive Tool, holding a **Selection** and split into two Subtools, **Pick** and **Marquee**. Painting Tools never select; Select itself never paints.
_Avoid_: Pointer, move tool, arrow

**Selection**:
The set of Map elements (Hexes, Features, Labels, Regions) currently picked out — zero, one, or many. Shown in the Inspector and moved together by a drag. Built by Select's clicks and modifiers; not part of the document, so never undone or persisted.
_Avoid_: Highlight, focus, active item

**Pick**:
The default Select Subtool: click selects the topmost entity under the cursor and drag moves the whole Selection. Repeated plain clicks at one coordinate cycle *deeper* through the stack — `Label → Feature → Hex → each Region containing that coordinate (document order) → wrap` — so an overlapped or interior Region becomes reachable. A plain click replaces the Selection; Cmd/Ctrl-click toggles the topmost entity in it; Shift-click toggles the whole stack at that coordinate; a click on empty space clears it.
_Avoid_: Move tool, arrow

**Marquee**:
The Select Subtool that drags a rectangle to select every Hex and Label within it. Regions are not marquee-selectable — they have no single position.
_Avoid_: Rubber band, lasso, box select

**Erase**:
The Tool that deletes a whole Hex record (its terrain *and* feature), turning the coordinate back into Void. Distinct from the Feature tool's Clear Subtool, which removes only the feature and leaves the terrain.
_Avoid_: Delete, clear, remove

**Inspector**:
The surface that shows and edits the currently selected Map element, including its Entity Link. For a Label it edits text/size/rotation/position; for a Region it edits name, color, deletion, and the Add/Remove membership direction — the *only* place Region details are edited. Engaging a Region's Add/Remove here arms the Region membership brush on that Region — the only way to arm it, now that Region is not a palette Tool (ADR-0012).
_Avoid_: Side panel, details pane, properties

**Regions panel**:
A list of every Region (named, colored, including ones currently empty and so invisible on the map), plus a New Region action. Selecting a Region here is equivalent to selecting it on the canvas. Shares its on-screen home with the Inspector.
_Avoid_: Region legend, layers, list
