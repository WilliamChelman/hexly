# Content

The bundled plugin contributing rich prose: the `core.datatype.rich-content` Structured Data Type, the canonical `core.field.content` Field, and the `core.type.note` Entity type. Builds on the **Platform** context (see [CONTEXT-MAP.md](../../CONTEXT-MAP.md)).

## Language

**Rich Content**:
Rich text as a _kind_ — the `core.datatype.rich-content` Structured Data Type: block-based prose with its own editor and harvest. An Entity has prose only where a Field of this Data Type is present, and may have more than one.
_Avoid_: Content (the canonical Field, not the kind), rich text (informal prose only), document, prose

**Content**:
The canonical prose Field — `core.field.content`, of the Rich Content Data Type — the one Field every Type that means to carry prose references. "The Entity's Content" names the value at that key.
_Avoid_: Rich Content (the Data Type, not this Field); Body; rich text; document; prose

**Note**:
An Entity carrying the `core.type.note` type — a worldbuilding page that is its prose and nothing else, a first-class Entity that Map elements link to.
_Avoid_: Description, comment, annotation, lore

**Outline**:
A navigation view of a Content's headings — a nested, click-to-jump list marking the heading in view. Derived from the Content, never stored; a Panel in the Dock, contributed by the Rich Content View.
_Avoid_: Table of contents, TOC, minimap, nav panel
