# Hexly

A web application for TTRPG worldbuilding: authoring interlinked **Entities** — prose pages and hex maps — persisted to user accounts and shared.

## Entities

**Entity**:
The top-level thing a user creates, owns, and shares. Carries a `name`, a `type`, `tags`, an optional **Metadata** map, and a rich-text **Content** body. A **Hex Map** is one kind of Entity. The unit of ownership, sharing, and saving.
_Avoid_: Document, page, record, object

**Entity Type**:
A closed set that decides an Entity's shape: `note` (Content only) and `hexmap` (Content plus a hex grid).
_Avoid_: Kind, category, class

**Content**:
The rich-text body every Entity carries — the result of block-based editing. Replaces the old per-element "Note".
_Avoid_: Body, rich text, document, prose

**Metadata**:
An arbitrary key→value map on an Entity, mirroring Obsidian frontmatter/properties. Populated from a note's frontmatter on import and re-emitted as YAML frontmatter on export. Keys under the reserved `hexly.` namespace carry Hexly's own provenance and are consumed on export rather than written back to frontmatter.
_Avoid_: Frontmatter, properties, attributes, custom fields

**Asset**:
A binary file — typically an image, but also a PDF or other media — belonging to a World and referenced from an Entity's Content. Served by an unguessable, unauthenticated link, so possession of the link is the only access control (even for an Asset referenced from a `private` Entity).
_Avoid_: Attachment, file, blob, media, upload

**Tag**:
A free-text label on an Entity, for flavour and informal grouping (e.g. "deity", "ruined", "northern reach"). Carries no behaviour; distinct from the structured Entity Type.
_Avoid_: Keyword, category, label

**Entity Link**:
An optional reference to an Entity by id, from either a Map element (a Hex, Feature, or Region — not a Label) or inline within another Entity's Content (prose): e.g. a settlement Feature pointing at the town's `note`, or a sentence in one note linking to another `hexmap`. A link to a missing or inaccessible Entity renders non-navigable — a Content link shows its last-known name as a dangling label — rather than erroring. A Content link may carry an optional Link Descriptor.
_Avoid_: Reference, relation, backlink

**Link Descriptor**:
An optional free-text label on a Content Entity Link, characterising the relationship it expresses (e.g. "spouse", "rival", "capital of"). Like a Tag, but on a link rather than an Entity: carries no behaviour, one per link. A one-way annotation — it does not imply a reciprocal link on the target.
_Avoid_: Relationship, relation, role, type

**Map element**:
A placed thing *within* a Hex Map — a Hex, Feature, Region, or Label — that can be selected and moved, and (except a Label) can carry an Entity Link. The in-map counterpart to a top-level Entity. (Formerly called "entity" informally; renamed to free that word for the top-level type.)
_Avoid_: Entity, item, object

## Language

**Hex Map**:
An **Entity** of type `hexmap`: its Content (lore) plus a grid of hexes, overlays, regions, and labels. The grid is an infinite sparse plane — a Hex exists only where painted. Ownership, sharing, and saving are properties of the Entity, not the grid.
_Avoid_: Map document, board, canvas

**Hex**:
A cell the user has given content to, stored at its coordinate. The map is an infinite plane, so a Hex exists *only* where painted — there is no bounded grid of pre-existing cells. Carries exactly one terrain, plus optional content: at most one feature and an optional name.
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
An Entity of type `note`: a prose worldbuilding page (a character, a faction, a place, a bit of history) whose substance is its Content. The lore, description, and secrets — a first-class Entity that Map elements link to, not text attached to a single Map element.
_Avoid_: Description, comment, annotation, lore

**Name**:
A short identifying title carried by a Map element — a Hex (e.g. a village's name) or a Region. On a Hex it is optional, and only a painted Hex can hold one; it travels with the Hex's content when moved or swapped. The renderer draws it minimally, anchored to the hex. Distinct from a Label (free, hand-placed typography) and from a linked Entity's own `name`.
_Avoid_: Title, caption, label

**Label**:
A free-positioned text element drawn on the map (a point + text + size + optional rotation), not snapped to the hex grid — used for cartographic typography like region or ocean names. Distinct from an entity's `name` field, which the renderer may draw but which is not a Label.
_Avoid_: Text, caption, title, annotation

## Worlds

**World**:
A lightweight container record that groups Entities for a single campaign or setting. Not an Entity type — it lives outside the entity model. Every Entity belongs to exactly one World. Carries a name and an owner. Its landing surface is the derived World Dashboard; it holds an ordered set of Pinned Entities surfaced there.
_Avoid_: Space, container, campaign

**World Dashboard**:
The per-World landing surface at `/w/:worldId` — the front door on entering a World. A read-only *derived* view (recent Entities, Hex Maps, at-a-glance counts) plus the Owners' curated Pinned Entities. It authors nothing of its own — so authored landing prose, if wanted, is just a Note the Owner pins. Distinct from the World Index (lists Worlds, at `/`) and the Entity Browser (lists this World's Entities, at `/entities`).
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
A per-World view of its Entities as nodes and their Entity Links as edges — the node-link picture of how a World's Entities connect. Entity-only (Assets are never nodes) and access-filtered per viewer: an Entity appears only if the viewer can read it, and an edge only when the viewer can read *both* endpoints — so it never reveals a `private` Entity. Orphan Entities (no links) still appear, as isolated nodes. A derived, read-only view — sibling to the World Dashboard and Entity Browser.
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
The closed set of actions a given caller may perform on a specific Entity or World — e.g. reading it, editing its substance, deleting it, changing its visibility, managing its sharing. Derived from the sharing rules (a caller's standing as Owner, grantee, or member) rather than granted directly. The vocabulary is per resource kind: a World is not something one "edits the substance" of. Distinct from a role (Owner, Editor, Contributor… — a collaboration role, not an Instance Role), which is *why* a caller holds a Right; the Rights are the resolved *what*.
_Avoid_: Permissions, ACL, capabilities, grants (a grant is one input to Rights, not the Rights)

**Entity Visibility**:
A two-value field on every Entity: `private` (default) or `shared`. A `private` Entity is accessible only to its Owners and any entity-level grants (named Editor/Viewer, or anonymous via its Public Link) — World Owners and Instance Role holders have no special access to it; private is absolute within the collaboration model (only a Superadmin, outside the model, can reach it). A `shared` Entity is accessible to all World members (Contributor, World Viewer, World Public Link holders). Per-user visibility is not a separate feature — it is what an entity-level grant on a `private` Entity delivers.
_Avoid_: Published, public, visible

**Owner**:
A user holding full control of an Entity — substance, lifecycle (delete), exposure (visibility), and grant/link management. Ownership is a symmetric set — one or more Owners, all equal, any Owner may add or remove other Owners; the creator (initially the sole Owner) holds no special status after creation. Invariant: at least one Owner. A `private` Entity is private to its Owner set.
_Avoid_: Admin, creator, co-owner

**Editor**:
A named user — any user on the Instance, World membership not required — granted permission to edit a specific Entity's substance: Content, name, Tags, Metadata. Never its lifecycle or exposure: no delete, no visibility change, no grant management.
_Avoid_: Collaborator, contributor

**Viewer**:
A named user — any user on the Instance, World membership not required — granted read-only access to a specific Entity.
_Avoid_: Reader, guest

**Public Link**:
An unguessable, unlisted URL that grants read-only access to a specific Entity without an account — an anonymous Viewer grant, so it pierces `private` like any entity-level grant; revoking the link is how access is withdrawn. Distinct from the World Public Link, which covers all `shared` Entities in a World.
_Avoid_: Share link, public URL, share token

**Live-follow**:
A viewer in read mode seeing another user's *committed* changes to the Entity or World they are looking at appear on their own screen without a manual refresh — e.g. a player watching a `shared` Hex Map the GM is editing, or a World Dashboard whose pins the Owner is reordering. Applies to committed versions, not keystrokes. Extends to anonymous World/Entity Public Link viewers. If the followed resource becomes unreachable (made `private`, un-shared, link revoked, or deleted), the follower's view is evicted rather than left stale. Never overwrites the follower's own unsaved edits: an editor with local changes keeps them and resolves the concurrent edit at save time.
_Avoid_: Real-time sync, live editing, collaboration, streaming

## Placement modes

Every piece of map content sits in exactly one of three placement modes:

- **Hex-locked** — snapped to a hex coordinate: Terrain, Feature.
- **Edge/vertex** — riding on the boundaries between hexes: Overlay (rivers, roads, borders).
- **Free-positioned** — at an arbitrary point, off the grid: Label.

## Editing tools

**Tool**:
A top-level editing mode armed in the palette — Select, Terrain, Feature, Label, Erase. Exactly one is armed at a time, and a canvas gesture applies it. A map opens armed with Select (its Pick Subtool). Region is *not* a palette Tool: Regions are created in the Regions panel and their membership is painted via the Inspector's Add/Remove brush.
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
The surface that shows and edits the currently selected Map element, including its Entity Link. For a Label it edits text/size/rotation/position; for a Region it edits name, color, deletion, and the Add/Remove membership direction — the *only* place Region details are edited. Engaging a Region's Add/Remove here arms the Region membership brush on that Region — the only way to arm it.
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

## Entity Browser

**Entity Browser**:
The durable, in-World surface that lists a single World's Entities as a card grid and lets the user find them by Facets and by a full-text query matched against an Entity's name, Tags, and the prose of its Content. Scoped to one World — distinct from the Command Palette (global, transient, cross-World) and the World Index (lists Worlds, not Entities).
_Avoid_: Entity list, library, catalog, explorer; fuzzy search (the query is full-text, ranked by relevance)

**Facet**:
A filterable dimension of a World's Entities offered in the Entity Browser with its distinct values and their counts — Type, Tag, and Visibility. Selecting values within one Facet is OR; across Facets is AND; the combined filter is AND-ed with the text query.
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
A Superadmin repair action that recomputes every Entity's document-derived state — its searchable text, Link Descriptor vocabulary, and link edges — from the authoritative Content and map, across all Worlds. Idempotent and safe to run anytime: the Entity's document is the source of truth, and the derived tables are a cache it rebuilds. A repair tool, not part of daily administration — which is why it is the Superadmin's, not the `manage-users` role's (which reaches no Entity). It runs as one instance-wide background job the operator polls, and a document this build cannot parse is skipped and reported rather than allowed to abort the walk.
_Avoid_: Rebuild, refresh, recompute, sync
