# Hexly

A web application for TTRPG worldbuilding: authoring interlinked **Entities** — prose pages and hex maps — persisted to user accounts and shared.

## Entities

**Entity**:
The top-level thing a user creates, owns, and shares. Carries a `name`, an ordered set of **Entity Types**, a set of directly-attached **Fields**, `tags`, and an **Entity Document** — the one key→value map that is its whole substance, prose included. Its _effective_ Field set is its types' default Fields (resolved live) unioned with the Fields it attaches directly, so one deity may carry a `world.field.element` Field and another not, without the deity type naming it. A **Hex Map** is one kind of Entity. The unit of ownership, sharing, and saving.
_Avoid_: page, record, object; Document (an Entity _has_ an **Entity Document**, it is not one)

**Entity Type**:
A user-facing identity an Entity carries — `core.type.note`, `core.type.hex-map`, `dnd.type.monster`, `world.type.deity`. An **open**, `namespace.type.name`-keyed set (every registered id carries its kind segment — ADR-0064). A _semantic bag_: it **references** (by id) a set of **default Fields**, declares an ordered set of **Views**, and names its facets — it does not _own_ its Fields, it points at them, and the same Field may be a default of many types or attached to an Entity with no such type at all. An Entity holds an **ordered set** of types; the first is _primary_ — driving its icon, default view, and headline — and may also carry **Fields** its types never named. Two flavours: a **Plugin type** (code, instance-wide, bespoke view) and a **User-defined type** (data, World-scoped, generic view).
_Avoid_: Kind, category, class; payload kind (retired — a type adds Fields, not a body shape); container (a type references Fields, it does not contain them)

**View**:
A distinct togglable renderer + editor an Entity affords — today's Note/Map toggle, generalized. An **open**, `namespace.view.name`-keyed set — the same kind-segment pattern as every registered id (ADR-0064), so a View id can never collide with an **Entity Type** or **Field** id. A View is contributed either by a **Type** (a plugin's stat-block; the generic Field view that renders user-defined and absent-plugin types) or by a **structured Data Type** (the map view, the content view) — and such a View is bound to _that Field_, so an Entity with two grids affords two map Views, and one with a `core.field.content` and a `world.field.secrets` Field affords two content Views, each labelled by its Field. The afforded Views resolve over the Entity's **effective Field set**, not just its types': a Type _places_ its default Fields' Views in its own ordered list (so a Hex Map still opens on its map), and a Field attached directly to an Entity appends its View after those. The primary type's first View is the default; a single-View Entity shows no toggle. No View is guaranteed: an Entity whose Type this build does not register affords only the generic Field view, its prose among the values it shows unrendered.
_Avoid_: Surface (kept only for informal prose like "landing surface"), tab, mode, panel

**Field**:
A named, typed, **reusable** slot — `core.field.content`, `dnd.field.strength`, `world.field.element` — referenced by id from an **Entity Type**'s defaults, attached directly to an **Entity**, or both. Identified by a single `namespace.field.name` **id** — its reuse handle and single source of truth — which _is_ the **Entity Document** key it lenses: one namespaced key, so a rename changes only the `label`, never the key, and no two Fields share a key. Carries that id, a `label`, a **Data Type**, and whether it is `required`/`facetable`. A typing _lens_ over the Entity Document, not a separate store: values live in the one map, so an absent Field definition (a disabled plugin, a deleted World-defined Field) leaves them as plain document values — as does a bare, un-namespaced document key, which no Field lenses. A Field of a structured **Data Type** is never _directly_ facetable — the blob has no discrete values to count — though its Data Type may **harvest** facet dimensions from the value (see **Structured Data Type**). Two flavours mirroring an Entity Type: a **Plugin field** (code, instance-wide) and a **User-defined field** (data, World-scoped, `world.field.*`-keyed). Validated _forward-only_ — enforced on active typed edits, tolerated on imported or at-rest data.
_Avoid_: Property, attribute, column, custom field

**Data Type**:
The _kind_ of a **Field**: what its value is shaped like, and how it is edited, validated, edge-harvested, and vault-projected. The _type of a Field_, as an **Entity Type** is the type of an Entity. An **open** set — the **built-ins** (`string`, `number`, `boolean`, `date`, `enum`, `list`, or a typed **Entity Link**) and the **structured** ones a plugin contributes (see **Structured Data Type**), marked by a `namespace.datatype.name` id, where a built-in stays a bare word — the kind segment is itself the built-in/structured line (ADR-0064). Reusable: many Fields share one Data Type. A Field's parameters — an `enum`'s options, a `list`'s item type, a link's target types — live on the **Field**, not the Data Type, so the Data Type stays a bare kind.
_Avoid_: Field Type (rejected rename — the kind layer keeps the data-type name), kind (informal prose only), payload kind

**Structured Data Type**:
A **Data Type** a plugin contributes rather than a built-in: a value with its own schema, its own link-edge harvesting, its own searchable text, its own **Vault Projection**, and its own **View** — edited on that View, not in a form row. A Hex Map's grid is one (`core.datatype.hex-grid`); so is an Entity's prose (`core.datatype.rich-content`). Its `namespace.datatype.name` id is what marks it structured — no built-in carries the `datatype` segment; a **Field** of a structured Data Type is never _directly_ facetable (the blob has no discrete values to count) — but a structured Data Type may **harvest** facet dimensions from its value, the way it harvests link-edges and searchable text: it declares its dimensions (each a facet key, label, and **Data Type**) and emits their values per Entity, so a stat block still surfaces its challenge-rating and size facets. Faceting a structured value keys off the Data Type's harvest, never the Field's `facetable` flag. A Field carrying one — the grid at the `core.field.grid` key, prose at `core.field.content` — is what earlier drafts called a _Structured Field_; the structured-ness is the **Data Type's**, not the Field's. The concept that _replaced_ the retired Payload Kind and swallowed prose into **Rich Content**, so an Entity's substance is one shape — the **Entity Document** — for every Entity.
_Avoid_: Payload, payload kind, blob, opaque field, complex field; Structured Field (the _type_ is structured, not the field)

**Vault Projection**:
How a **Field**'s value takes its place in an exported Markdown file, declared by the Field (a structured **Data Type** supplying the default): the `body` — the Markdown prose below the frontmatter — or `frontmatter` (YAML, nested if need be), or `omit`. Prose projects to the body, a grid to frontmatter. An Entity may hold **several** body Fields — a deity with `core.field.content` and `world.field.secrets` — and they are written in Field order, each preceded by an HTML comment naming its key (`<!-- hexly:field world.field.secrets -->`) so the file round-trips; the comment is emitted only when there is more than one, so an ordinary Note is plain Markdown. An unmarked body — a hand-written note, a foreign vault — imports into the Entity's first body Field.
_Avoid_: Export strategy, serialization, slot

**Type Definition**:
The registration that gives an **Entity Type** its default **Fields** (referenced by id), Views, and facets. Either a **Plugin type** — declared in code by a bundled plugin at startup, instance-wide, shipping a bespoke view (even `core.type.note` and `core.type.hex-map` register this way — both the Note and the Hex Map ship as bundled plugins, framework-free half and all, so the app itself names no type and the plugin API cannot rot un-exercised) — or a **User-defined type** — authored as data by a **World Owner**, scoped to one World, rendered by the generic Field view. Code buys only the bespoke view; everything else — default Fields, facets, link-fields, a Field of a **Structured Data Type** and its View, primary, multi-type — works code-lessly. Its Field _definitions_ live in their own registration (a **Plugin field** or **User-defined field**); a Type Definition only lists the ids it defaults.
_Avoid_: Schema, template, model, class

**Rich Content**:
Rich text as a _kind_ — the `core.datatype.rich-content` **Structured Data Type**: block-based prose with its own editor, its own link-edge and searchable-text harvest, and a `body` **Vault Projection**. Not a place on the Entity: an Entity has prose only where a **Field** of this Data Type is present — defaulted by a **Type** or attached directly — and may have more than one (a deity's public **Content** and its `world.field.secrets`); a **Text Block** holds one loose on a **Board Surface**. Shipped by a bundled plugin, like the **Hex Map**: an Instance without it has no editor to open one on.
_Avoid_: Content (the canonical **Field**, not the kind — an Entity's `world.field.secrets` is Rich Content but not Content), rich text (informal prose only), document, prose

**Content**:
The canonical prose **Field** — `core.field.content`, of the **Rich Content** Data Type — the one Field every Type that means to carry prose references, so a multi-type Entity resolves exactly one. "The Entity's Content" names the value at that key: its lore, its page body. Other prose Fields sit beside it as peers (`world.field.secrets`), each affording its own content View.
_Avoid_: Rich Content (the Data Type, not this Field); Body (an Entity has no body, only its **Entity Document** — `body` is the Markdown file's prose region, see **Vault Projection**); rich text; document; prose

**Entity Document**:
The one open key→value map on an Entity — its whole authored substance, there is no second store. A key a **Field** lenses is still an ordinary document key: the Field only types and surfaces it, and that holds for a Field of a **Structured Data Type** too — a Hex Map's grid and an Entity's prose are document values like any other, which is why a missing plugin leaves them intact and readable. Frontmatter is not what the document _is_ but one **Vault Projection** of it: an imported note's frontmatter populates it, and on export a Field goes to frontmatter or to the Markdown body as its projection says. Keys under the reserved `hexly.` namespace carry Hexly's own provenance and are consumed on export rather than written back. Stored serialized in the `document` column; its type is `EntityDocument`, and a local holding one is named `doc` (never `document`, which shadows the browser global).
_Avoid_: Metadata (retired as the map's name — kept only as the read-only **properties** panel's UI label and the ADR-0037 name/visibility "metadata patch"); frontmatter (a projection, not a synonym); properties; attributes; custom field

**Asset**:
A binary file — typically an image, but also a PDF or other media — belonging to a World and referenced from an Entity's Content or from a **Board Surface** (an **Image** element). Served by an unguessable, unauthenticated link, so possession of the link is the only access control (even for an Asset referenced from a `private` Entity).
_Avoid_: Attachment, file, blob, media, upload

**Tag**:
A free-text label on an Entity, for flavour and informal grouping (e.g. "ruined", "northern reach") — user-invented on the spot, carrying no behaviour. Both Tags and **Entity Types** are multi-valued labels; the line between them is _registration_: a Type is a registered category (Plugin or World-defined) carrying Fields, a view, and facets, whereas a Tag is not. "Deity" is a Tag until someone defines it as a Type.
_Avoid_: Keyword, category, label

**Entity Link**:
An optional reference to an Entity by id, from a Map element (a Hex, Feature, or Region — not a Label), inline within another Entity's Content (prose), a typed **Field** on an Entity, or a Board's **Embed** element: e.g. a settlement Feature pointing at the town's `note`, a sentence in one note linking to another `hexmap`, a monster's `lair` Field pointing at a place, or a Board embedding a `note` rendered in place. Most forms are merely navigable; an **Embed** additionally _renders_ its target inline by transclusion. A link to a missing or inaccessible Entity renders non-navigable — a Content link shows its last-known name as a dangling label, an Embed a dangling placeholder — rather than erroring. A Content link may carry an optional Link Descriptor.
_Avoid_: Reference, relation, backlink

**Link Descriptor**:
An optional free-text label on a Content Entity Link, characterising the relationship it expresses (e.g. "spouse", "rival", "capital of"). Like a Tag, but on a link rather than an Entity: carries no behaviour, one per link. A one-way annotation — it does not imply a reciprocal link on the target.
_Avoid_: Relationship, relation, role, type

**Map element**:
A placed thing _within_ a Hex Map — a Hex, Feature, Region, or Label — that can be selected and moved, and (except a Label) can carry an Entity Link. The in-map counterpart to a top-level Entity. (Formerly called "entity" informally; renamed to free that word for the top-level type.)
_Avoid_: Entity, item, object

## Import

**Importer**:
A code-registered producer that turns an external source into **Entities** — the Draw Steel monster pack, a future bestiary or ruleset. A **Plugin** contributes one by `namespace.importer.name` (`draw-steel.importer.monsters`) as its single server entry point's `importers`; it only **fetches and transforms**, yielding **Import Records**, and never touches the database, provenance, or the write choke point — the framework's reconcile does. Owner-triggered, per **World**, from the generic Imports panel; the same generic panel and reconcile serve every Importer, so a Plugin adds one by shipping a `produce()` and its copy. Distinct from the **Vault** import, which mints a World of Notes from a Markdown zip.
_Avoid_: Loader, seeder, sync, connector

**Import Record**:
An **Importer**'s unit of output: a `sourceId`, a `name`, an ordered **Entity Type** set, and an **Entity Document** — everything the framework needs to mint or update one **Entity**, and nothing about _how_ it lands. The reconcile matches Records to existing Entities by **Import Source** and upserts; a Record whose transform failed is skipped and tallied, never aborting the run.
_Avoid_: Row, DTO, payload, seed

**Import Source**:
The provenance an **Entity** carries from the **Importer** that produced it: the reserved `hexly.source` **Entity Document** key `{ importer, sourceId, rev }` — _which_ importer owns it, its **stable** upstream id, and the pinned source revision it reflects. The source of truth for wipe-and-reimport; a Plugin absent, it is an inert `hexly.*` value like any other. Reimport is an **identity-preserving overwrite** keyed on `(importer, sourceId)` — the Entity id is reused so inbound **Entity Links** survive, and the Entity's authored edits are _not_ preserved: an imported set is a **managed reference library**, not a customization surface. Mirrored by the derived `entityImportSource` index (an **index, never a source of truth**, like the facet and link indexes) so a World can be filtered by provenance without loading a single document.
_Avoid_: Origin, provenance record, external id, sync key

## Language

**Hex Map**:
An **Entity** carrying the `core.type.hex-map` type — the type that defaults two Fields, the canonical **Content** Field (its lore) and the grid of hexes, overlays, regions, and labels (a Field of the `core.datatype.hex-grid` **Structured Data Type**). The grid is an infinite sparse plane — a Hex exists only where painted. Ownership, sharing, and saving are properties of the Entity, not the grid. Shipped by a bundled plugin, not by the core: an Instance without it opens a Hex Map on the generic Field view, grid and lore alike unrendered **Entity Document** values — the ordinary absent-plugin degradation. The hex-locked sibling of the free-positioned **Board**.
_Avoid_: Map document, board (now the free-positioned sibling Entity — see **Board**), canvas

**Hex**:
A cell the user has given content to, stored at its coordinate. The map is an infinite plane, so a Hex exists _only_ where painted — there is no bounded grid of pre-existing cells. Carries exactly one terrain, plus optional content: at most one feature and an optional name.
_Avoid_: Cell, tile, square

**Void**:
A coordinate with no Hex record — untouched space on the infinite plane. Rendered as a neutral background; carries no data.
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
An Entity carrying the `core.type.note` type — the type that declares nothing but the canonical **Content** Field, so an Entity is its prose and nothing else: a worldbuilding page (a character, a faction, a place, a bit of history). The lore, description, and secrets — a first-class Entity that Map elements link to, not text attached to a single Map element. Shipped by the same bundled plugin as the Content Field and the editor that fills it.
_Avoid_: Description, comment, annotation, lore

**Name**:
A short identifying title carried by a Map element — a Hex (e.g. a village's name) or a Region. On a Hex it is optional, and only a painted Hex can hold one; it travels with the Hex's content when moved or swapped. The renderer draws it minimally, anchored to the hex. Distinct from a Label (free, hand-placed typography) and from a linked Entity's own `name`.
_Avoid_: Title, caption, label

**Label**:
A free-positioned text element drawn on the map (a point + text + size + optional rotation), not snapped to the hex grid — used for cartographic typography like region or ocean names. Distinct from an entity's `name` field, which the renderer may draw but which is not a Label.
_Avoid_: Text, caption, title, annotation

## Board

**Board**:
An **Entity** carrying the `core.type.board` type — a free-positioned 2D worldbuilding surface, the sibling of the **Hex Map**. The type defaults two Fields: the canonical **Content** (its lore) and the surface at the `core.field.surface` key (a Field of the `core.datatype.board-surface` **Structured Data Type**), an infinite plane of **Board Elements**. Ownership, sharing, and saving are properties of the Entity, not the surface. Shipped by a bundled **Plugin** (`board`), not the core: an Instance without it opens a Board on the generic **View**, surface and lore alike unrendered **Entity Document** values — the ordinary absent-plugin degradation.
_Avoid_: Canvas (kept only for the informal gesture-surface sense — the thing you drag on), board as a Hex Map synonym (retired — the Board is its own Entity now), scene, collage, whiteboard

**Board Surface**:
The `core.datatype.board-surface` **Structured Data Type** — a Board's substance: an infinite 2D plane, panned and zoomed by a camera, holding a z-ordered set of **Board Elements**. It **harvests** link edges (every **Embed**'s target and every inline **Entity Link** inside a **Text Block**) and searchable text (Text Block prose), and harvests no facets. Its **Vault Projection** is `frontmatter` — the whole element model serialized losslessly — while the Board's lore **Content** projects to the body.
_Avoid_: Canvas, board (bare — the Entity is the Board; this is its surface Data Type), grid (the Hex Map's), plane

**Board Element**:
A placed thing on a **Board Surface** — the free-positioned counterpart to a **Map element**. Carries geometry (a position and a size) and an explicit **z-order** for stacking. Three kinds today: an **Image**, an **Embed**, and a **Text Block**. Selected, moved, and resized with the Board's Select **Tool**; the interactive kinds (Embed, Text Block) additionally **arm** on a click into them, as a Tool arms — one armed at a time, click-out disarms.
_Avoid_: Item, node, card (that is the Embed's fallback rendering), widget, shape

**Image**:
A **Board Element** that displays an **Asset** — an Asset reference plus geometry. Always static (never armed). Sourced by uploading a new file (which mints a World **Asset**) or by picking an existing one. The Board Surface is a second Asset reference site beside **Content**, so Asset-usage accounting must count it.
_Avoid_: Picture, photo, media, sprite

**Embed**:
A **Board Element** that renders another **Entity** inline by full live transclusion of a chosen **View** — `{ target Entity, View }`, the View selectable per Embed. An **Entity Link**: it emits a link edge, appears in the **World Graph**, and resolves per viewer through the access filter — an unreadable or deleted target renders as a dangling, non-navigable placeholder. Bounded by cycle detection and a configurable maximum render depth (**Instance Configuration**, default 3), past which — or when the chosen View cannot render (its Field gone, its **Plugin** disabled) — it degrades to a **card preview** (name, type icon, snippet). Static until clicked, when it **arms** for read-interaction only (pan, scroll, click-through); editing the target means opening it, never editing through the Embed.
_Avoid_: Transclusion (the mechanism, not the element), card (the fallback rendering, not the Embed), portal, inset, iframe

**Text Block**:
A **Board Element** holding a `core.datatype.rich-content` value — rich text authored on the surface, with formatting and inline **Entity Links**, edited with the same editor as an Entity's **Content**. Static until clicked, when it **arms** its editor; click-out disarms. Its prose feeds the **Board Surface**'s searchable text and its inline links the link harvest. Distinct from a **Label** (a Hex Map's minimal cartographic typography, not rich text).
_Avoid_: Label (the map's minimal text), note, sticky, caption, text box

## Worlds

**World**:
A lightweight container record that groups Entities for a single campaign or setting. Not an Entity type — it lives outside the entity model. Every Entity belongs to exactly one World. Carries a name and an owner. Its landing surface is the derived World Dashboard; it holds an ordered set of Pinned Entities surfaced there.
_Avoid_: Space, container, campaign

**World Dashboard**:
The per-World landing surface at `/w/:worldId` — the front door on entering a World. A read-only _derived_ view (recent Entities, Hex Maps, at-a-glance counts) plus the Owners' curated Pinned Entities. It authors nothing of its own — so authored landing prose, if wanted, is just a Note the Owner pins. Distinct from the World Index (lists Worlds, at `/`) and the Entity Browser (lists this World's Entities, at `/entities`).
_Avoid_: Home Entity, world home, landing page, overview

**Pinned Entity**:
An Entity an Owner has featured on the World Dashboard. The pin set is a World property — one shared, ordered list, the same for everyone, curated only by World Owners. A pin is a reference by id, resolved per viewer through the ordinary access filter: a pinned Entity the caller can't reach (`private` without a grant, or deleted) simply drops off their Dashboard.
_Avoid_: Bookmark, favourite, featured note

**World Index**:
The page at `/` listing every World the caller can reach — owned, member, or holding any Entity the caller owns or is granted — and the surface that owns World create, rename, and delete. The durable directory of Worlds — distinct from the World Switcher (a transient quick-hop control) and from a World's own World Dashboard (its in-world landing surface).
_Avoid_: World home, world library, world picker

**World Switcher**:
The compact in-app control at the nav-rail masthead for hopping to another reachable World without returning to the World Index. Pure navigation — it shows the current World and switches the URL scope; it does not manage Worlds. Shown only inside a World; on the World Index the Index itself is the chooser, so the Switcher is absent.
_Avoid_: World selector, world dropdown

**World Graph**:
A per-World view of its Entities as nodes and their Entity Links as edges — the node-link picture of how a World's Entities connect. Entity-only (Assets are never nodes) and access-filtered per viewer: an Entity appears only if the viewer can read it, and an edge only when the viewer can read _both_ endpoints — so it never reveals a `private` Entity. Orphan Entities (no links) still appear, as isolated nodes. A derived, read-only view — sibling to the World Dashboard and Entity Browser.
_Avoid_: web, network, mind map, relationship map, world map (collides with Hex Map)

**World Owner**:
A user holding full control of a World: membership, roles, the public link, World rename/delete, and full control (edit, delete, change visibility) over every `shared` Entity in the World. No special access to others' `private` Entities. Ownership is a symmetric set — one or more Owners, all equal, any Owner may add or remove other Owners; the creator holds no special status after creation. Invariant: at least one Owner (the last cannot be removed or resign).
_Avoid_: Admin, GM (user vocabulary, not system vocabulary), co-owner (an Owner is an Owner)

**Contributor**:
A named user granted the ability to create Entities inside a World (becoming each created Entity's initial sole Owner) and to read all `shared` Entities. Cannot edit Entities they do not own unless granted entity-level Editor access separately.
_Avoid_: Editor, member, player

**World Viewer**:
A named user (or public link holder) granted read-only access to all `shared` Entities in a World.
_Avoid_: Reader, guest, spectator

**World Public Link**:
An unguessable, unlisted URL that grants World Viewer access to all `shared` Entities in a World without an account.
_Avoid_: Share link, invite link

## Sharing

**Rights**:
The closed set of actions a given caller may perform on a specific Entity or World — e.g. reading it, editing its substance, deleting it, changing its visibility, managing its sharing. Derived from the sharing rules (a caller's standing as Owner, grantee, or member) rather than granted directly. The vocabulary is per resource kind: a World is not something one "edits the substance" of. Distinct from a role (Owner, Editor, Contributor… — a collaboration role, not an Instance Role), which is _why_ a caller holds a Right; the Rights are the resolved _what_.
_Avoid_: Permissions, ACL, capabilities, grants (a grant is one input to Rights, not the Rights)

**Entity Visibility**:
A two-value field on every Entity: `private` (default) or `shared`. A `private` Entity is accessible only to its Owners and any entity-level grants (named Editor/Viewer, or anonymous via its Public Link) — World Owners and Instance Role holders have no special access to it; private is absolute within the collaboration model (only a Superadmin, outside the model, can reach it). A `shared` Entity is accessible to all World members (Contributor, World Viewer, World Public Link holders). Per-user visibility is not a separate feature — it is what an entity-level grant on a `private` Entity delivers.
_Avoid_: Published, public, visible

**Owner**:
A user holding full control of an Entity — substance, lifecycle (delete), exposure (visibility), and grant/link management. Ownership is a symmetric set — one or more Owners, all equal, any Owner may add or remove other Owners; the creator (initially the sole Owner) holds no special status after creation. Invariant: at least one Owner. A `private` Entity is private to its Owner set.
_Avoid_: Admin, creator, co-owner

**Editor**:
A named user — any user on the Instance, World membership not required — granted permission to edit a specific Entity's substance: its **Entity Document** (prose, grid, properties), name, and Tags. Never its lifecycle or exposure: no delete, no visibility change, no grant management.
_Avoid_: Collaborator, contributor

**Viewer**:
A named user — any user on the Instance, World membership not required — granted read-only access to a specific Entity.
_Avoid_: Reader, guest

**Public Link**:
An unguessable, unlisted URL that grants read-only access to a specific Entity without an account — an anonymous Viewer grant, so it pierces `private` like any entity-level grant; revoking the link is how access is withdrawn. Distinct from the World Public Link, which covers all `shared` Entities in a World.
_Avoid_: Share link, public URL, share token

**Live-follow**:
A viewer in read mode seeing another user's _committed_ changes to the Entity or World they are looking at appear on their own screen without a manual refresh — e.g. a player watching a `shared` Hex Map the GM is editing, or a World Dashboard whose pins the Owner is reordering. Applies to committed versions, not keystrokes. Extends to anonymous World/Entity Public Link viewers. If the followed resource becomes unreachable (made `private`, un-shared, link revoked, or deleted), the follower's view is evicted rather than left stale. Never overwrites the follower's own unsaved edits: an editor with local changes keeps them and resolves the concurrent edit at save time.
_Avoid_: Real-time sync, live editing, collaboration, streaming

## Placement modes

Every piece of map content sits in exactly one of three placement modes:

- **Hex-locked** — snapped to a hex coordinate: Terrain, Feature.
- **Edge/vertex** — riding on the boundaries between hexes: Overlay (rivers, roads, borders).
- **Free-positioned** — at an arbitrary point, off the grid: Label.

## Editing tools

These concepts are surface-agnostic — shared by every surface editor (the **Hex Map**, the **Board**) — but the _toolset_ is per-plugin: each surface Plugin supplies its own Tools. Code-sharing a surface-editor lib is a separate, later call. The terms below are illustrated with the Hex Map's toolset unless noted.

**Tool**:
A top-level editing mode armed in a surface editor's palette. Exactly one is armed at a time, and a canvas gesture applies it. The set is per-surface: a Hex Map arms Select, Terrain, Feature, Label, Erase; a Board arms Select, Image, Embed, Text. A surface opens armed with Select. (On the Hex Map, Region is _not_ a palette Tool: Regions are created in the Regions panel and their membership is painted via the Inspector's Add/Remove brush.)
_Avoid_: Mode, brush, instrument

**Subtool**:
A mutually-exclusive variant _within_ a Tool — the Terrain tool's individual terrains, the Feature tool's individual features (and its Clear variant), and the Select tool's **Pick** and **Marquee**. Tools that have Subtools remember the last one used for the session. Label and Erase have no Subtools.
_Avoid_: Sub-mode, option, variant

**Select**:
The one non-destructive Tool, holding a **Selection** and split into two Subtools, **Pick** and **Marquee**. Painting Tools never select; Select itself never paints.
_Avoid_: Pointer, move tool, arrow

**Selection**:
The set of placed elements currently picked out — Map elements on a Hex Map (Hexes, Features, Labels, Regions), Board Elements on a Board — zero, one, or many. Shown in the Inspector and moved together by a drag. Built by Select's clicks and modifiers; not part of the document, so never undone or persisted.
_Avoid_: Highlight, focus, active item

**Pick**:
The default Select Subtool: click selects the topmost entity under the cursor and drag moves the whole Selection. Repeated plain clicks at one coordinate cycle _deeper_ through the stack — `Label → Feature → Hex → each Region containing that coordinate (document order) → wrap` — so an overlapped or interior Region becomes reachable. A plain click replaces the Selection; Cmd/Ctrl-click toggles the topmost entity in it; Shift-click toggles the whole stack at that coordinate; a click on empty space clears it.
_Avoid_: Move tool, arrow

**Marquee**:
The Select Subtool that drags a rectangle to select every Hex and Label within it. Regions are not marquee-selectable — they have no single position.
_Avoid_: Rubber band, lasso, box select

**Erase**:
The Tool that deletes a whole Hex record (its terrain _and_ feature), turning the coordinate back into Void. Distinct from the Feature tool's Clear Subtool, which removes only the feature and leaves the terrain.
_Avoid_: Delete, clear, remove

**Inspector**:
The surface that shows and edits the currently selected element. On a Hex Map that is a Map element, including its Entity Link: for a Label it edits text/size/rotation/position; for a Region it edits name, color, deletion, and the Add/Remove membership direction — the _only_ place Region details are edited, and engaging Add/Remove here arms the Region membership brush on that Region (the only way to arm it). On a Board it is a Board Element: geometry and z-order for all, plus an Image's Asset, an Embed's target Entity and View.
_Avoid_: Side panel, details pane, properties

**Regions panel**:
A list of every Region (named, colored, including ones currently empty and so invisible on the map), plus a New Region action. Selecting a Region here is equivalent to selecting it on the canvas. Shares its on-screen home with the Inspector.
_Avoid_: Region legend, layers, list

## Command Palette

**Command Palette**:
A Cmd/Ctrl+K overlay, reachable from anywhere in the app regardless of route or active World, for finding Entities and Worlds and invoking Commands. Distinct from the World Switcher (Worlds only) and the Inspector's Entity Link picker (one Content Link's target only) — the Command Palette is the one cross-cutting search-and-act surface.
_Avoid_: Quick open, search bar, spotlight

**Command**:
A single invocable entry in the Command Palette — e.g. creating a Note, or navigating to a matched Entity or World. Distinct from a Tool: invoking a Command may arm a Tool, but a Command is not itself one.
_Avoid_: Action, shortcut

**Command Prefix**:
The leading marker that routes a Command Palette query to the **Command Providers** bound to it — empty is Quick Open (Entity/World search), `>` is Show Commands, `/r ` is a **Roll**. Many-to-one: several Providers may answer one prefix. A query routes to the **longest** registered prefix it starts with, so multi-character prefixes coexist with single-character ones and no provider hard-codes the set.
_Avoid_: Sigil, trigger, mode key

## Dice

**Roll**:
An ephemeral evaluation of a **Dice Expression** into a **Roll Result** — a live, in-session action, **never persisted**: it writes nothing to an **Entity Document**, adds no server surface, and vanishes on reload. Raised two ways: from the **Command Palette** under the `/r ` **Command Prefix**, or from a context button (today, a Draw Steel **Power Roll**, which resolves ephemerally while its stored tiers stay render-faithful prose — Hexly rolls, but never stores the roll).
_Avoid_: Throw, dice throw (informal only), roll record, roll log (nothing is logged)

**Dice Expression**:
The notation a **Roll** evaluates: dice terms (`NdM`) combined with arithmetic (`+ - * /` and parentheses, division flooring) and per-term modifiers (keep/drop highest-lowest, exploding, reroll). Parsed forward-only — invalid text yields a typed error surfaced to the user, never a throw.
_Avoid_: Formula, dice string, notation (bare)

**Roll Result**:
The structured outcome of a **Roll** — the per-die faces, per-term subtotals, and the numeric total. Presented ephemerally: flashed through the toaster for a palette Roll, or in an anchored bubble for a button Roll. Any reading beyond the total (a Draw Steel tier band) belongs to the caller, not the Roll.
_Avoid_: Outcome, score, value

## Entity Browser

**Entity Browser**:
The durable, in-World surface that lists a single World's Entities as a card grid and lets the user find them by Facets and by a full-text query matched against an Entity's name, Tags, and the prose of its Content. Scoped to one World — distinct from the Command Palette (global, transient, cross-World) and the World Index (lists Worlds, not Entities).
_Avoid_: Entity list, library, catalog, explorer; fuzzy search (the query is full-text, ranked by relevance)

**Facet**:
A filterable dimension of a World's Entities offered in the Entity Browser with its distinct values and their counts — Type, Tag, and Visibility always, plus facetable **Fields** (and the dimensions a **Structured Data Type** harvests) surfaced _by presence_: a Field Facet appears whenever the current result set carries values for its key, whatever types those Entities hold. Selecting values within one Facet is OR; across Facets is AND; the combined filter is AND-ed with the text query.
_Avoid_: Filter, dimension, aspect

## Outline

**Outline**:
A navigation view of a Content's headings — a nested, click-to-jump list that also marks the heading currently in view. Derived from the Content, never stored. Available wherever an Entity shows its Content body — a Note, or a Hex Map on its Note view. Sibling to the Inspector and Regions panel.
_Avoid_: Table of contents, TOC, minimap, nav panel

## User preferences

**User Settings**:
The account-owned page where a signed-in user edits their own **Preferences** and profile — display name and password (email is shown read-only). Distinct from a World's membership settings (World Owner surface) and from Instance Configuration (operator settings).
_Avoid_: Account settings, profile page, options

**Preferences**:
A user's roaming presentation choices — UI **Locale**, **Format Locale**, and theme — bound to the account so they follow the user across devices. Anonymous public-link viewers, who have no account, still get these choices locally. Distinct from Instance Configuration (operator, per-Instance) and World membership settings.
_Avoid_: Settings, options, config

**Locale**:
A user's chosen **interface language** (English or French today) — which strings the UI renders. Distinct from Format Locale: Locale picks the words, Format Locale picks how dates and numbers read.
_Avoid_: Language (as a field name), i18n, region

**Format Locale**:
A user's chosen **regional formatting** (a BCP-47 tag) governing how dates, numbers, and times are rendered, independent of the UI **Locale** — so an English reader can see day-month dates. Defaults to the UI Locale when unset.
_Avoid_: Date format, regional settings, locale (bare — that means the UI language)

## Self-hosting

**Plugin**:
A bundled, compiled-in unit that contributes **Entity Types**, **Fields**, their **Views**, and **Structured Data Types** (and its own copy) to an Instance — the delivery mechanism behind every code Type, `core.type.note` and `core.type.hex-map` included. Identified by a canonical `id` (`content`, `hexmap`, `dnd`) its own framework-free half declares, kept distinct from any type namespace because the `core` namespace is shared by two Plugins (content and hexmap). "Bundled" means shipped in the build, not installed at runtime — there are no third-party Plugins. Enabled by default; an operator disables one in **Instance Configuration** (`features.plugin.<id>.enabled: false`), and a disabled Plugin is indistinguishable from one this build never bundled — on both server and client its Types degrade to the generic **View**, values intact.
_Avoid_: Extension, addon, module, package

**Instance**:
A single self-hosted deployment of Hexly, over one Instance Directory. The unit an operator runs, configures, and backs up.
_Avoid_: Server, deployment, tenant

**Instance Directory**:
The folder an operator points Hexly at, holding its database and Instance Configuration — named for holding both data and config.
_Avoid_: Data directory, data folder, db path, storage dir

**Instance Role**:
A member of the closed, code-known set of instance-wide powers a user may hold, stored as a set (`roles`) on the user account. Two members today: `manage-users` — account management (create, disable, and delete users, reset passwords, and grant/revoke Instance Roles), refusing a user's deletion while they solely own any World or Entity and using disable (login locked, data and memberships intact) as the immediate lever — and `create-worlds` — may create Worlds. The members are orthogonal: holding one implies nothing about the other, and `manage-users` carries zero content powers, reaching no World or Entity (granting oneself `create-worlds` is an explicit, visible act). "Role" here is account-wide, scoped by the word Instance; distinct from a collaboration role (Owner, Editor, Viewer, Contributor), which is a standing on a specific World or Entity. Superadmin is not an Instance Role.
_Avoid_: Instance Admin (retired), Admin (ambiguous with Superadmin), capability, permission, flag

**Superadmin**:
The in-app embodiment of the operator: unrestricted access, sitting outside the collaboration model entirely and superseding every Instance Role. Exists for repair — orphaned data, accidental deletions — not for day-to-day account management (that is the `manage-users` role's job). A separate account flag, not a member of the `roles` set; at least one per Instance, seeded at setup, and the last one is irremovable. The operator's repair tools are reachable only by a Superadmin today, though an Instance Role could be granted that access later.
_Avoid_: Root, god mode, owner

**Instance Configuration**:
Operator-facing settings for one Instance, stored beside the database. Distinct from per-User or per-World settings, which live in the database.
_Avoid_: Config, settings, preferences, environment

**Reindex**:
A Superadmin repair action that recomputes every Entity's document-derived state — its searchable text, Link Descriptor vocabulary, link edges, and facets — from the authoritative **Entity Document**, across all Worlds, asking each **Field** for the text and edges its value carries. Idempotent and safe to run anytime: the Entity's document is the source of truth, and the derived tables are a cache it rebuilds. A repair tool, not part of daily administration — which is why it is the Superadmin's, not the `manage-users` role's (which reaches no Entity). It runs as one instance-wide background job the operator polls, and a document this build cannot parse is skipped and reported rather than allowed to abort the walk.
_Avoid_: Rebuild, refresh, recompute, sync
