# Hexly

A web application for TTRPG worldbuilding: authoring interlinked **Entities** — prose pages and hex maps — persisted to user accounts and shared.

## Entities

**Entity**:
The top-level thing a user creates, owns, and shares: a `name`, an ordered set of **Entity Types**, directly-attached **Fields**, `tags`, and an **Entity Document**. The unit of ownership, sharing, and saving; it belongs to exactly one **Container**.
_Avoid_: page, record, object; Document (an Entity _has_ an **Entity Document**, it is not one)

**Entity Type**:
A user-facing identity an Entity carries — an **open**, `namespace.type.name`-keyed set (ADR-0064) that references default **Fields** by id and declares **Views** and facets. An Entity holds an ordered set of types; the first is _primary_, driving its icon, default view, and headline.
_Avoid_: Kind, category, class; payload kind (retired); container (a type references Fields, it does not contain them)

**View**:
A distinct togglable renderer + editor an Entity affords — an open, `namespace.view.name`-keyed set, contributed either by a **Type** or by a structured **Data Type** and bound to the **Field** carrying it. The primary type's first View is the default (ADR-0050).
_Avoid_: Surface (informal prose only), tab, mode, panel

**Field**:
A named, typed, **reusable** slot referenced by a **Type**'s defaults or attached directly to an **Entity** — its `namespace.field.name` id _is_ the **Entity Document** key it lenses (ADR-0056). A typing _lens_ over the document, never a separate store. Two flavours: a **Plugin field** (code, instance-wide) and a **User-defined field** (data, **Container**-scoped). A Field may be marked `required`, which prompts rather than gates — see **Incomplete**.
_Avoid_: Property, attribute, column, custom field

**Incomplete**:
An **Entity** missing a value for a Field its **Types** mark `required` — a readable state, never a refused save. `required` prompts an author and flags a surface; only a _present_ but ill-typed value is invalid (ADR-0074).
_Avoid_: Invalid, malformed, draft, unsaved, partial; validation error (that names the ill-typed case)

**Data Type**:
The _kind_ of a **Field**: what its value is shaped like and how it is edited and validated. An open set — the built-ins (`string`, `number`, `boolean`, `date`, `enum`, `list`, **Entity Link**) plus the **structured** ones plugins contribute; a Field's parameters (an `enum`'s options, a link's target types) live on the Field, not the Data Type.
_Avoid_: Field Type (rejected rename), kind (informal prose only), payload kind

**Structured Data Type**:
A **Data Type** a plugin contributes rather than a built-in — a value with its own schema, its own harvesting (link edges, searchable text, facet dimensions), its own **Vault Projection**, and usually its own **View** (`core.datatype.hex-grid`, `core.datatype.rich-content`). The `datatype` kind segment is what marks it structured; the structured-ness is the Data Type's, never the Field's (ADR-0050, ADR-0055).
_Avoid_: Payload, payload kind, blob, opaque field, complex field; Structured Field

**Vault Projection**:
Where a **Field**'s value takes its place in an exported Markdown file: the `body`, the `frontmatter`, or `omit`. Declared by the Field, defaulted by its structured **Data Type** (ADR-0051).
_Avoid_: Export strategy, serialization, slot

**Type Definition**:
The registration that gives an **Entity Type** its default **Fields** (referenced by id), Views, and facets — either a **Plugin type** (code, instance-wide, bespoke view) or a **User-defined type** (data, **Container**-scoped, generic view).
_Avoid_: Schema, template, model, class

**Rich Content**:
Rich text as a _kind_ — the `core.datatype.rich-content` **Structured Data Type**: block-based prose with its own editor and harvest. An Entity has prose only where a Field of this Data Type is present, and may have more than one.
_Avoid_: Content (the canonical **Field**, not the kind), rich text (informal prose only), document, prose

**Content**:
The canonical prose **Field** — `core.field.content`, of the **Rich Content** Data Type — the one Field every Type that means to carry prose references. "The Entity's Content" names the value at that key.
_Avoid_: Rich Content (the Data Type, not this Field); Body; rich text; document; prose

**Entity Document**:
The one open key→value map on an Entity — its whole authored substance; there is no second store. A key a **Field** lenses is still an ordinary document key, which is why a missing plugin leaves values intact and readable.
_Avoid_: Metadata (retired); frontmatter (a projection, not a synonym); properties; attributes; custom field

**Asset**:
An **Entity** carrying the `core.type.asset` type — a binary file (an image today; PDFs, audio later) wrapped as the unit users browse, rename, tag, share, and delete. Two access layers, deliberately distinct: the Entity sits under the ordinary sharing model, while its **bytes** are served by an unguessable capability link (ADR-0034, ADR-0065).
_Avoid_: Attachment, file, blob, media, upload; Asset Entity (an Asset _is_ an Entity)

**Missing Bytes**:
The state of an **Asset** whose bytes are not under the resolved Assets root — an unmounted volume, a relocated `assets.dir`, a half-synced folder. A named state, not an error: content-addressed write-once bytes degrade to _missing_, never to corrupt, so the Entity, its **Asset Stats** and its prose are all intact and the fix is restoring the file. Checked per read as one stat at the address the dedup index already holds, so it clears without a **Reindex**.
_Avoid_: Broken, corrupt, orphaned, dangling (a dead **Entity Link**, not this), lost

**Asset Stats**:
Mechanical facts derived from an **Asset**'s bytes — an image's dimensions, orientation, and dominant color; later a PDF's page count, an audio file's duration. Computed, never authored.
_Avoid_: Metadata (overloaded), EXIF, properties, stats (bare, in prose about anything else)

**Augmentation**:
An interpretive, machine-produced description or tags on an **Asset** — a future AI plugin's output. Distinct from **Asset Stats** (mechanical facts) and **Tags** (authored labels).
_Avoid_: AI tags, annotation, auto-tags, labels

**Thumbnail**:
The small image standing in for an **Entity** wherever it renders as a tile or row, sourced from its own bytes (an **Asset**) or its Thumbnail Field — the canonical `core.field.thumbnail`, an **Entity Link** to an image Asset. Absent both, surfaces fall back to the primary type's icon (ADR-0066).
_Avoid_: Cover, portrait, avatar, preview

**Tag**:
A free-text label on an Entity, for flavour and informal grouping — user-invented, carrying no behaviour. The line against an **Entity Type** is _registration_: "Deity" is a Tag until someone defines it as a Type.
_Avoid_: Keyword, category, label

**Entity Link**:
An optional reference to an Entity by id — from a Map element, inline within Content prose, a typed **Field**, or a Board's **Embed**. A link whose target is missing or inaccessible is **dangling**: it renders non-navigable, showing the last-known label, rather than erroring. Distinct from an **Unresolved Link**, which never carried an id at all.
_Avoid_: Reference, relation, backlink

**Unresolved Link**:
An **Entity Link** carrying a label but no id — a name the prose mentions that no Entity answers to. Produced only by a **Vault** import whose wikilink matched no note, never authored by hand, and **promoted** in place into a real Entity. Unlisted by construction: nothing indexes it, so it is found by reading the prose it sits in (ADR-0073).
_Avoid_: Empty link, parked link, placeholder, targetless link; dangling (a link whose _target_ went away, not one that never had one)

**Decor Link**:
A link that exists for presentation, carrying no worldbuilding meaning — a **Thumbnail**, an image in prose or a Board **Image** (any capability-URL reference is decor by construction). Declared by the link's producer, e.g. a flagged **Field**. Relation surfaces (the References panel, the **World Graph**) subdue Decor Links by default behind a reveal; usage readings count them always. A Board **Embed** is never decor — embedding is curatorial.
_Avoid_: Non-semantic link, presentational link, irrelevant link

**System-managed**:
A marker on an **Entity Type** or **Field** meaning the system alone assigns and removes it — users never add, remove, attach, or detach it, on any surface or through the API; its _value_ is not the marker's concern. `core.type.asset` and `core.field.asset` carry it.
_Avoid_: Hidden, internal, readonly, locked; hidden-from-default-listing (a separate, discoverability axis)

**Link Descriptor**:
An optional free-text label on a Content Entity Link, characterising the relationship it expresses ("spouse", "capital of"). Like a Tag, but on a link; one per link, one-way.
_Avoid_: Relationship, relation, role, type

**Inline Creation**:
Minting an Entity from a mention rather than from a create surface — the `@` picker's create, the promotion of an **Unresolved Link**, and a **Vault** import's opt-in creation of the Entities its wikilinks name. It carries its own configured **Entity Type** and an optional triage **Tag**, so an Entity born mid-sentence is still classified and findable (ADR-0073).
_Avoid_: Quick create, on-the-fly entity, auto-create, stub

**Map element**:
A placed thing _within_ a Hex Map — a Hex, Feature, Region, or Label — selectable, movable, and (except a Label) able to carry an Entity Link.
_Avoid_: Entity, item, object

## Import

**Importer**:
A code-registered producer that turns an external source into **Entities** — contributed by a **Plugin** as `namespace.importer.name`, it only fetches and transforms, yielding **Import Records** (ADR-0060). A **Compendium Importer** reconciles into a **Compendium**; any other into a **World**. Distinct from the **Vault** import.
_Avoid_: Loader, seeder, sync, connector

**Import Record**:
An **Importer**'s unit of output: a `sourceId`, a `name`, an ordered **Entity Type** set, and an **Entity Document** — everything needed to mint or update one Entity, nothing about _how_ it lands.
_Avoid_: Row, DTO, payload, seed

**Import Source**:
The provenance an **Entity** carries from the **Importer** that produced it — the reserved `hexly.source` document key `{ importer, sourceId, rev }`. Reimport is an identity-preserving overwrite within one **Container**, keyed on `(importer, sourceId)` (ADR-0060). An **Adoption** deliberately carries none.
_Avoid_: Origin, provenance record, external id, sync key

## Compendium

**Compendium**:
A **Container** of published reference material — one per pack, Instance-wide, installed and removed by the operator rather than authored in place, and carrying its own attribution (publisher, license, notice). Its Entities are **Sealed**, so the only way to use one is **Adoption** (ADR-0079). Reachable by **every signed-in caller and no one else**: Instance-wide with no members means being on this Instance _is_ the standing, so there is nothing per-caller to resolve — the one reachability rule **Collaboration** does not answer (ADR-0078).
_Avoid_: Library (retired), catalog, SRD, bestiary (one pack's subject, not the kind); pack (informal prose for the published artifact only — the thing Hexly holds is a Compendium, and the interface says so: ADR-0079's "**Pack** facet" ships as the **Compendium** facet)

**Compendium browse**:
The durable surface listing every installed **Compendium**'s entries at `/w/:worldId/compendium` — the **Entity Browser** preset to the shelf, on the **Asset Browser**'s precedent, with the same search and the same **Facets**. It names its **Containers** explicitly, because the read is _about_ compendium content rather than about a World; the World in its URL names the **Adoption** target, not the content's home.
_Avoid_: Compendium page (that is a pack's own attribution page), pack browser, library

**Compendium Entry**:
An **Entity** that lives in a **Compendium** — defined by that location alone, never by a flag, never by an **Entity Type**, and never by "has an **Import Source**" (the **Vault** import will carry one too). An ordinary Entity in a **Sealed** state, never a kind of its own: absent from every World-scoped reading (the **Entity Browser**, **Facets**, the **World Graph**, a World's counts) by the plain fact of belonging to another **Container**, with no exclusion rule anywhere naming it.
_Avoid_: Compendium Entity (it is an Entity, in a place), record, item, stat block, monster (one pack's content)

**Sealed**:
The state of a **Compendium Entry**: read-only to everyone, the operator included, and never offered as a link target, so nothing outside its **Compendium** can point at it. A seal on _writing_, not on _reading_ — the **Command Palette** and full-text search still find it, ranked below authored Entities, and its own page opens to anyone signed in. Two halves held in two places: read-only is one structural refusal at the entity write choke point, on ADR-0068's precedent; the no-link rule is every link-target surface refusing to return one, never a write-time rejection — that would land on prose (ADR-0079). The seal is not a **Right** and no Right outranks it, but a sealed Entity's Rights report `read` alone, so nothing offers an affordance the write choke point would refuse.
_Avoid_: Locked, frozen, immutable, protected; read-only (one half of it), hidden (it is findable)

**Link-target read**:
A read asking _"what may this point at?"_ — the `@` mention picker, the **Entity Link** Field picker, the Board **Embed** picker, and the **Vault** import's wikilink name-resolution. It never returns a **Compendium Entry**, which is the whole of the **Sealed** state on the read side. Its opposite is a **navigation read** — the **Command Palette**, full-text search, an id resolution, an Entity's own page — which does return one, ranked below authored Entities. The three that query the Entity list declare which kind they are, so the rule is one rule and not four; the Vault import's resolution reads only the vault it is importing, so it satisfies the rule by never being able to reach a Compendium at all (ADR-0079).
_Avoid_: Picker read, link read, mention search; filtered read (it is a kind of read, not a filter on one)

**Compendium Importer**:
An **Importer** that declares its output to be reference material, so it reconciles into a **Compendium** rather than a **World**. The declaration is part of the **Importer** contract rather than a per-plugin convention, and carries the Compendium's name and its attribution, both captured on install. What the Importer produces is a **Compendium Entry** by virtue of landing there — which is why a hand-written NPC carrying `draw-steel.type.monster` is untouched by any of this and stays an ordinary Entity.
_Avoid_: Seeder, pack loader, content importer

**Adoption**:
Copying a **Compendium Entry** into a **World** as an ordinary, editable **Entity** — same name verbatim, same Types, same values, `private` and owned by the adopter, with no **Import Source** and no record of origin. The one way compendium content enters a world, which is what makes a World's Entities exactly the ones its authors chose (ADR-0079). It is the ordinary Entity create with the entry as its seed, so it asks only for the right to create Entities in the target World — a **Contributor** may adopt — and drops the provenance by the strip that create already does. Inbound links to the entry are never repointed, asking twice adopts twice with nothing flagging it, and the copy is frozen at the revision adopted, permanently.
_Avoid_: Fork, clone, instantiate, import (the **Importer**'s word), copy (the mechanism, not the act)

## Language

**Hex Map**:
An **Entity** carrying the `core.type.hex-map` type, whose grid Field (`core.datatype.hex-grid`) is an infinite sparse plane of hexes, overlays, regions, and labels. Shipped by a bundled plugin; the hex-locked sibling of the free-positioned **Board**.
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

**Note**:
An Entity carrying the `core.type.note` type — a worldbuilding page that is its prose and nothing else, a first-class Entity that Map elements link to.
_Avoid_: Description, comment, annotation, lore

**Name**:
A short identifying title carried by a Map element — a Hex or a Region. Distinct from a Label (free typography) and from a linked Entity's own `name`.
_Avoid_: Title, caption, label

**Label**:
A free-positioned text element drawn on the map, not snapped to the hex grid — cartographic typography like region or ocean names.
_Avoid_: Text, caption, title, annotation

## Board

**Board**:
An **Entity** carrying the `core.type.board` type — a free-positioned 2D worldbuilding surface, the sibling of the **Hex Map**, whose surface Field (`core.datatype.board-surface`) holds **Board Elements**. Shipped by a bundled plugin.
_Avoid_: Canvas (informal gesture-surface sense only), board as a Hex Map synonym (retired), scene, collage, whiteboard

**Board Surface**:
The `core.datatype.board-surface` **Structured Data Type** — an infinite 2D plane, panned and zoomed by a camera, holding a z-ordered set of **Board Elements**.
_Avoid_: Canvas, board (bare), grid (the Hex Map's), plane

**Board Element**:
A placed thing on a **Board Surface** — geometry plus an explicit z-order. Three kinds today: an **Image**, an **Embed**, and a **Text Block**; the interactive kinds **arm** on a click into them, one at a time.
_Avoid_: Item, node, card (the Embed's fallback rendering), widget, shape

**Image**:
A **Board Element** that displays an **Asset**'s bytes by capability link — _decor_, always static, cheap in quantity. Distinct from an **Embed** of an Asset (a reference with presence).
_Avoid_: Picture, photo, media, sprite

**Embed**:
A **Board Element** that renders another **Entity** inline by full live transclusion of a chosen **View** — an **Entity Link** that degrades to a card preview past the depth limit or when its View cannot render (ADR-0062).
_Avoid_: Transclusion (the mechanism, not the element), card (the fallback rendering), portal, inset, iframe

**Text Block**:
A **Board Element** holding rich text authored on the surface, edited with the same editor as an Entity's **Content**. Distinct from a **Label** (the map's minimal typography).
_Avoid_: Label, note, sticky, caption, text box

## Containers

**Container**:
What an **Entity** belongs to — a named set of Entities carrying their own vocabulary (**User-defined types** and **Fields**), link edges, facets, and asset bytes. Two kinds: a **World** and a **Compendium**. **Collaboration** is the World's alone; a Container as such has no members, roles, or public link (ADR-0078).
_Avoid_: Space, scope, bucket, namespace, workspace; World (one kind of Container, not the supertype)

**World**:
The **Container** holding the Entities of a single campaign or setting — the only kind a user authors into, and the one that carries **Collaboration**, a **World Theme**, and its **Pinned Entities**. Not an Entity type; carries a name and an owner.
_Avoid_: Space, container (the supertype, not this), campaign

**World Dashboard**:
The per-World landing surface — a read-only _derived_ view (recents, counts) plus the Owners' curated **Pinned Entities**. It authors nothing of its own.
_Avoid_: Home Entity, world home, landing page, overview

**Pinned Entity**:
An Entity an Owner has featured on the World Dashboard. The pin set is a World property — one shared, ordered list, resolved per viewer through the ordinary access filter.
_Avoid_: Bookmark, favourite, featured note

**World Index**:
The page at `/` listing every World the caller can reach — the durable directory of Worlds, owning World create, rename, and delete.
_Avoid_: World home, world library, world picker

**World Switcher**:
The compact in-app control for hopping to another reachable World — pure navigation, shown only inside a World.
_Avoid_: World selector, world dropdown

**World Graph**:
A per-World view of its Entities as nodes and their Entity Links as edges, access-filtered per viewer (an edge shows only when both endpoints are readable). A derived, read-only view.
_Avoid_: web, network, mind map, relationship map, world map (collides with Hex Map)

**Local Graph**:
The **World Graph** narrowed to one Entity's neighbourhood — every Entity within a chosen **depth** of hops (undirected, semantic edges only, so a **Decor Link** never widens it) and the edges between those. A Panel on the Entity page, not a page of its own (ADR-0072).
_Avoid_: Neighbourhood graph, ego graph, mini map, subgraph; local map (collides with Hex Map)

**World Owner**:
A user holding full control of a World — membership, roles, the public link, rename/delete, and full control over every `shared` Entity in it; no special access to others' `private` Entities. A symmetric set of one or more, all equal; the last cannot be removed.
_Avoid_: Admin, GM (user vocabulary), co-owner

**Contributor**:
A named user granted the ability to create Entities inside a World (becoming each created Entity's initial sole Owner) and to read all `shared` Entities.
_Avoid_: Editor, member, player

**World Viewer**:
A named user (or public link holder) granted read-only access to all `shared` Entities in a World.
_Avoid_: Reader, guest, spectator

**World Public Link**:
An unguessable, unlisted URL that grants World Viewer access without an account.
_Avoid_: Share link, invite link

## Sharing

**Rights**:
The closed set of actions a given caller may perform on a specific Entity or World, derived from the sharing rules. The resolved _what_; a role (Owner, Editor, Contributor…) is the _why_.
_Avoid_: Permissions, ACL, capabilities, grants (a grant is one input to Rights)

**Entity Visibility**:
A two-value field on every Entity: `private` (default — Owners and entity-level grants only) or `shared` (all World members). Private is absolute within the collaboration model; only a Superadmin, outside it, can reach a `private` Entity. Inert where **Collaboration** is off: nothing reads it, and every Entity keeps the default.
_Avoid_: Published, public, visible

**Owner**:
A user holding full control of an Entity — substance, lifecycle, exposure, and grant management. A symmetric set of one or more, all equal; at least one always.
_Avoid_: Admin, creator, co-owner

**Editor**:
A named user — World membership not required — granted permission to edit a specific Entity's substance, never its lifecycle or exposure.
_Avoid_: Collaborator, contributor

**Viewer**:
A named user — World membership not required — granted read-only access to a specific Entity.
_Avoid_: Reader, guest

**Public Link**:
An unguessable, unlisted URL granting read-only access to a specific Entity without an account — an anonymous Viewer grant, so it pierces `private`.
_Avoid_: Share link, public URL, share token

**Live-follow**:
A viewer in read mode seeing another user's _committed_ changes appear without a manual refresh — committed versions, not keystrokes (ADR-0044/0045). An unreachable followed resource evicts the view rather than leaving it stale.
_Avoid_: Real-time sync, live editing, collaboration, streaming

## Placement modes

Every piece of map content sits in exactly one of three placement modes:

- **Hex-locked** — snapped to a hex coordinate: Terrain, Feature.
- **Edge/vertex** — riding on the boundaries between hexes: Overlay (rivers, roads, borders).
- **Free-positioned** — at an arbitrary point, off the grid: Label.

## Editing tools

Surface-agnostic concepts shared by every surface editor (the **Hex Map**, the **Board**); the _toolset_ itself is per-plugin.

**Tool**:
A top-level editing mode armed in a surface editor's palette — exactly one armed at a time, applied by a canvas gesture. The set is per-surface; a surface opens armed with Select.
_Avoid_: Mode, brush, instrument

**Subtool**:
A mutually-exclusive variant _within_ a Tool — a terrain, a feature, Select's **Pick** and **Marquee**. Tools with Subtools remember the last one used for the session.
_Avoid_: Sub-mode, option, variant

**Select**:
The one non-destructive Tool, holding a **Selection**, split into **Pick** and **Marquee**. Painting Tools never select; Select never paints.
_Avoid_: Pointer, move tool, arrow

**Selection**:
The set of placed elements currently picked out — zero, one, or many — shown in the Inspector and moved together. Not part of the document, so never undone or persisted.
_Avoid_: Highlight, focus, active item

**Pick**:
The default Select Subtool: click selects the topmost element under the cursor, drag moves the Selection, and repeated clicks cycle _deeper_ through the stack (ADR-0017).
_Avoid_: Move tool, arrow

**Marquee**:
The Select Subtool that drags a rectangle to select every Hex and Label within it. Regions are not marquee-selectable.
_Avoid_: Rubber band, lasso, box select

**Erase**:
The Tool that deletes a whole Hex record, returning the coordinate to Void. Distinct from the Feature tool's Clear Subtool, which removes only the feature.
_Avoid_: Delete, clear, remove

**Inspector**:
The surface that shows and edits the currently selected element — and the _only_ place Region details are edited (ADR-0011/0012). A write-gated **Panel** in the **Dock**, contributed by the surface editor's View.
_Avoid_: Side panel, properties; details pane (the Entity's **Details panel** is a different surface — the Inspector is about the selected element)

**Regions panel**:
A list of every Region (empty ones included) plus a New Region action; selecting a Region here is equivalent to selecting it on the canvas. A write-gated **Panel** contributed by the Map View.
_Avoid_: Region legend, layers, list

## Command Palette

**Command Palette**:
A Cmd/Ctrl+K overlay, reachable from anywhere, for finding Entities and Worlds and invoking Commands — the one cross-cutting search-and-act surface.
_Avoid_: Quick open, search bar, spotlight

**Command**:
A single invocable action, listed in the **Command Palette** and, in the **Desktop App**, in the native app menu. Distinct from a Tool: invoking a Command may arm a Tool, but a Command is not one.
_Avoid_: Action, shortcut

**Command Prefix**:
The leading marker that routes a Command Palette query to the **Command Providers** bound to it — empty is Quick Open, `>` is Show Commands, `/r ` is a **Roll**. The longest registered prefix wins (ADR-0059).
_Avoid_: Sigil, trigger, mode key

## Dice

**Roll**:
An ephemeral evaluation of a **Dice Expression** into a **Roll Result** — a live, in-session action, **never persisted**.
_Avoid_: Throw, dice throw (informal only), roll record, roll log (nothing is logged)

**Dice Expression**:
The notation a **Roll** evaluates: dice terms (`NdM`) with arithmetic and per-term modifiers. Parsed forward-only — invalid text yields a typed error, never a throw.
_Avoid_: Formula, dice string, notation (bare)

**Roll Result**:
The structured outcome of a **Roll** — per-die faces, per-term subtotals, and the total. Presented ephemerally; any reading beyond the total belongs to the caller.
_Avoid_: Outcome, score, value

## Entity Browser

**Entity Browser**:
The durable, in-World surface listing a single **World**'s Entities as a card grid, found by **Facets** and a full-text query — labelled **Entities** in the nav rail. Scoped to one World, so it never shows a **Compendium Entry** — distinct from the Compendium browse (reference material, Instance-wide), the Command Palette (global, transient), and the World Index (lists Worlds).
_Avoid_: Entity list, library (retired as a UI label too — it read as reference material, which is the **Compendium**), catalog, explorer; fuzzy search (the query is full-text, ranked)

**Asset Browser**:
The **Entity Browser** preset to the asset type, presented as thumbnail tiles with upload at hand. Rename, share, and delete are ordinary Entity operations.
_Avoid_: Media library, gallery, asset manager, file manager

**Facet**:
A filterable dimension of the Entities a browse lists — a **World**'s, or the **Compendium browse**'s — with its distinct values and counts — Type, Tag, and Visibility always, plus facetable **Fields**, harvested dimensions, and the **Compendium** itself, surfaced _by presence_. Values within one Facet OR; across Facets AND.
_Avoid_: Filter, dimension, aspect; Pack facet (it is the **Compendium** facet)

## Dock

**Dock**:
The Entity page's right-side surface, present on every **View** — page chrome, not View content, so absent wherever a View renders alone (a Board **Embed**). Holds at most one open **Panel**; the choice is per-user and follows the user across Views.
_Avoid_: Right rail, sidebar, drawer; rail (the nav rail and the map's editor rail)

**Panel**:
One togglable unit within the **Dock** — contributed universally (References, the **Details panel**) or by the active **View** (Outline, Regions, **Inspector**). A Panel may claim the open slot programmatically (selecting a Map element opens the Inspector) without overwriting the user's remembered choice.
_Avoid_: Tab, pane, widget, side panel

**Details panel**:
The universal **Panel** holding an Entity's shape and substance in one place: its **Entity Types** (add/remove), its **Fields** (edited in place, attached/detached inline), and its untyped **Entity Document** keys (read-only). Management controls appear only for writers. The **Details View** — the fallback main content when an Entity affords no other View — renders the same at full width.
_Avoid_: Fields panel (superseded), properties, metadata, sidebar

## Outline

**Outline**:
A navigation view of a Content's headings — a nested, click-to-jump list marking the heading in view. Derived from the Content, never stored. A **Panel** in the **Dock**, contributed by the Rich Content View.
_Avoid_: Table of contents, TOC, minimap, nav panel

## User preferences

**User Settings**:
The account-owned page where a signed-in user edits their own **Preferences** and profile. Distinct from World membership settings and Instance Configuration.
_Avoid_: Account settings, profile page, options

**Preferences**:
A user's roaming presentation choices — UI **Locale**, **Format Locale**, and **ColorScheme** — bound to the account so they follow the user across devices.
_Avoid_: Settings, options, config

**Locale**:
A user's chosen **interface language** — which strings the UI renders.
_Avoid_: Language (as a field name), i18n, region

**Format Locale**:
A user's chosen **regional formatting** (a BCP-47 tag) for dates, numbers, and times, independent of the UI **Locale**; defaults to it when unset.
_Avoid_: Date format, regional settings, locale (bare — that means the UI language)

## Appearance

**ColorScheme**:
The day/night axis the interface is painted along — `Light` or `Dark`. A user **Preference**, never a World's to set: a **World Theme** supplies both, and the reader chooses which one they see. Named for what it is rather than for the **Palette Presets** Hexly happens to wear at each end (ADR-0077).
_Avoid_: Theme (bare), dark mode, colour mode, scheme (bare), light/dark toggle; Solar, Astral (those are **Palette Presets**)

**World Theme**:
The presentation a **World Owner** authors for one World — a **Palette** per **ColorScheme**, plus a radius set and a font pairing. Purely presentational: it never changes what an Entity contains or who may read it, and a reader keeps their own **ColorScheme** within it.
_Avoid_: Skin, style, branding, world palette, theme (bare — that used to mean the **ColorScheme**)

**Palette**:
The small set of anchor colours one **ColorScheme** of a **World Theme** is authored as; every other colour the interface uses derives from it. What an Owner actually fills in, whether by hand or by taking a **Palette Preset**.
_Avoid_: Swatch set, colour scheme, theme; terrain palette (that set is the **Terrain** list); graph palette (the **World Graph** paints each **Entity Type** in its **Tone**)

**Palette Preset**:
One of the **Palettes** Hexly ships ready to pick — a whole **Palette** for one **ColorScheme**, offered as a starting point and applied by copying its values into a **World Theme**, which then holds values and no name. **Solar** and **Astral** are two of them, and are also the pair Hexly itself wears (ADR-0077).
_Avoid_: Theme preset, built-in theme, stock palette, swatch, skin; preset (bare — a radius set and a font pairing are offered the same way)

**Anchor**:
One of the eight colours a **Palette** is authored as — page, ink, quiet ink, accent, danger, success, canvas, and soot — each carrying its own hue, which is how the light→dark rotation is expressed (ADR-0075). Every role the interface styles itself from is one expression over these, so a component asks for the role and never the Anchor.
_Avoid_: Base colour, brand colour, primitive, swatch, primary/secondary

**Knob**:
One of the three numbers a **Palette** carries beside its **Anchors** — polarity (±1, the mirror between the two **ColorSchemes**), line alpha, and veil — turned rather than picked, and read by the expressions the roles derive through (ADR-0075).
_Avoid_: Slider, parameter, colour setting; knob (bare, outside Appearance — that is any dial an operator turns)

**Instance Default Theme**:
The presentation an operator sets for a whole deployment, in **Instance Configuration** — the same anchors as a **World Theme**, from a different source, and any subset of them, each **ColorScheme** given either as anchors or as the name of a **Palette Preset**. A starting point, not an imposition: a World's own **World Theme** wins over it field by field, and the chain is Instance Default Theme → **World Theme** → the reader's **ColorScheme**. Ships empty. Shortened to "Instance default" in running prose, and to `InstanceTheme` in code.
_Avoid_: Global theme, site theme, default palette, instance branding, house style

**Tone**:
One of the eight categorical colours an **Entity Type** is drawn in — its chip's text and border, its nodes in the **World Graph** — derived from the accent by hue rotation, and assigned by hashing the Type's id unless the Type pins one (ADR-0075). Never identity on its own: no eight-hue set survives deuteranopia, so a chip carries the Entity Type's icon beside its label and the colour decorates. The soft fill is emphasis, not category. `--color-tone-1…8` in the tokens, `ChipTone` in code.
_Avoid_: Colour, category colour, hue, tint; tone (as the light/dark polarity — that **Knob** ships as `--palette-polarity`)

## Self-hosting

**Plugin**:
A bundled, compiled-in unit contributing **Entity Types**, **Fields**, **Views**, **Structured Data Types**, and **Importers** to an Instance — shipped in the build, never installed at runtime. A disabled Plugin is indistinguishable from one never bundled: its Types degrade to the generic View, values intact (ADR-0052).
_Avoid_: Extension, addon, module, package

**Instance**:
A single self-hosted deployment of Hexly, over one Instance Directory, carrying a **Deployment Profile**. The unit an operator runs, configures, and backs up.
_Avoid_: Server, deployment, tenant

**Instance Directory**:
The folder an operator points Hexly at, holding its database and Instance Configuration.
_Avoid_: Data directory, data folder, db path, storage dir

**Deployment Profile**:
Which shape of deployment an **Instance** is — `desktop` or `server` — pinned by its entry point rather than configured, and read by the client to gate affordances that make sense in only one of them.
_Avoid_: Mode, environment, platform, packaging, target

**Desktop App**:
Hexly packaged as a native application — an Electron shell hosting the API in its own process over its own **Instance Directory**. Always the `desktop` **Deployment Profile** with **Collaboration** off, and never able to reach a remote Instance.
_Avoid_: Electron app, client, local mode, offline mode

**Collaboration**:
The sharing layer entire — World roles, entity grants, **Entity Visibility**, and Public Links — switched on or off per **Instance**. Off leaves a single **Sole User** owning everything, the sharing surfaces absent and their routes answering 404.
_Avoid_: Sharing (one part of it), ACL, permissions, multiplayer

**Sole User**:
The one account of an **Instance** whose **Collaboration** is off, holding **Superadmin** and every **Instance Role** so no rule ever denies it. The **Desktop App** seeds and authenticates its own at first launch, with no password involved.
_Avoid_: Local user, default user, admin, single user, anonymous

**Instance Role**:
A member of the closed set of instance-wide powers a user account may hold — `manage-users` and `create-worlds` today, orthogonal (ADR-0047). Distinct from a collaboration role (Owner, Editor…), which is a standing on a specific World or Entity.
_Avoid_: Instance Admin (retired), Admin (ambiguous with Superadmin), capability, permission, flag

**Superadmin**:
The in-app embodiment of the operator — unrestricted, outside the collaboration model entirely, existing for repair rather than day-to-day administration. A separate account flag, not an Instance Role; the last one is irremovable.
_Avoid_: Root, god mode, owner

**Instance Configuration**:
Operator-facing settings for one Instance, stored beside the database. Distinct from per-User or per-World settings.
_Avoid_: Config, settings, preferences, environment

**Reindex**:
A Superadmin repair action that recomputes every Entity's document-derived state from the authoritative **Entity Document**, across every **Container**. Idempotent — the derived tables are a cache it rebuilds.
_Avoid_: Rebuild, refresh, recompute, sync
