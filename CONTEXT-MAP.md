# Context Map

Hexly is a **host platform** plus a set of bundled **Plugins**. The platform owns the Entity substrate, Containers, sharing, and the shared browsing/editing surfaces; each plugin owns the vocabulary of the Entity type or Data Type it contributes. A word that is only meaningful inside one plugin (a Hex Map's **Name** and **Label**, a Board's **Image**) lives in that plugin's context, not the platform's.

## Contexts

- [Platform](./CONTEXT.md) — the host: Entity model, Containers, Compendium/import, sharing, appearance, self-hosting, and the shared editing/browsing surfaces every plugin builds on
- [Hex Map](./libs/plugin-hexmap/CONTEXT.md) — `core.type.hex-map` and the `core.datatype.hex-grid` surface: hexes, terrain, overlays, regions, labels
- [Board](./libs/plugin-board/CONTEXT.md) — `core.type.board` and the `core.datatype.board-surface`: a free-positioned 2D surface of images, embeds, and text blocks
- [Content](./libs/plugin-content/CONTEXT.md) — `core.datatype.rich-content`, the canonical `core.field.content` Field, and the `core.type.note` Entity
- [Asset](./libs/plugin-asset/CONTEXT.md) — `core.type.asset` and `core.field.asset`: binary files whose bytes are served behind a capability link

The `plugin-dnd` and `plugin-draw-steel` libs are game-system content packs; they contribute Entity Types and Importers but add no new ubiquitous language, so they have no context of their own.

## Relationships

- **Every plugin → Platform**: each plugin contributes **Entity Types**, **Fields**, **Views**, and **Structured Data Types** into the Platform's open registries; a disabled plugin degrades its Types to the generic View with values intact. All plugin vocabulary is downstream of the Platform's `Entity` / `Field` / `Data Type` kernel.
- **Hex Map ↔ Board (shared kernel)**: both are surface editors built on the Platform's `Tool` / `Subtool` / `Select` / `Selection` / `Pick` / `Inspector` vocabulary; the concrete toolset (a Hex Map's `Marquee`, `Erase`) is each plugin's own.
- **Board → Asset**: a Board `Image` displays an `Asset`'s bytes by capability link.
- **Board → any plugin**: a Board `Embed` transcludes any Entity's `View`, so it reaches across every other plugin's Types.
- **Board / Text Block → Content**: a `Text Block` is authored with the same editor as an Entity's `Content`.
- **Hex Map → Content / Platform**: a `Map element` carries an `Entity Link` — often to a `Note` or any other Entity.
- **Platform / Thumbnail → Asset**: the Platform's `Thumbnail` (`core.field.thumbnail`) is an `Entity Link` to an image `Asset`.
- **Asset → Platform**: `core.type.asset` and `core.field.asset` are `System-managed`; the `Asset Browser` is the Platform's `Entity Browser` preset to the asset type.
