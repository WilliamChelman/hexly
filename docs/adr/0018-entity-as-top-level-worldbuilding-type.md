# Entity is the top-level worldbuilding type; Hex Map is one kind of Entity

Worldbuilding is more than maps, so the top-level thing a user owns is generalized from **Hex Map** to **Entity**: an `id`, a `name`, a `type`, free-text `tags`, created/modified timestamps, and a rich-text **Content** body (ADR-0019). A **Hex Map** becomes an Entity of `type: 'hexmap'` — its Content (lore) **plus** the existing hex-grid payload (`hexMapSchema`, unchanged: ADR-0003/0005). The companion type at launch is `note` (Content only): the generic prose page — a character, faction, place, or bit of history.

`type` is a **closed, code-known enum** (`note | hexmap`). Only a *typed payload* (like the hex grid) justifies a new type; mere flavour is a `tag`. User- and plugin-defined types and properties are a long-term goal, explicitly **not** built now — a closed enum keeps the discriminated document type-safe and lets the editor know how to render each Entity.

This **extends ADR-0002**: the `maps` table becomes `entities` (add a `type` column, `title` → `name`, add `tags`), and the one `document` TEXT column now holds a **type-discriminated** JSON document — `{ content, ...typedPayload }`, where `typedPayload` is empty for `note` and is `hexMapSchema` for `hexmap`. Whole-document save and the optimistic `version` / 409 model are unchanged, just per-Entity. Sharing **extends ADR-0004**: Owner/Editor/Viewer roles and the public link generalize from Map to Entity, unchanged.

## Considered Options

- **A generic property-bag Entity (Notion-style, open types) now** — rejected as far more machinery than a ~5-user tool needs, and incompatible with a type-safe discriminated document. Deferred to the long-term plugin goal.
- **Keeping Hex Map as its own top-level type and bolting notes on separately** — rejected: it forks ownership, sharing, storage, and listing into two parallel stacks instead of one generalized one.
- **A "World" container as the unit of ownership/sharing** — deferred. At current scale per-Entity sharing suffices, and a `worldId` foreign key is an additive migration when worlds are wanted.

## Consequences

- The old per-element **Note** (Markdown attached to a Hex/Feature/Region/Map — defined in `CONTEXT.md` but never implemented) is **retired**. Lore lives in an Entity. A **Map element** (Hex, Feature, Region) instead carries an optional **Entity Link** (`entityId`) — e.g. a settlement Feature → the town's `note`, or → another `hexmap`.
- `entityId` is **not** referentially enforced (it lives inside the JSON document). A link to a deleted or inaccessible Entity collapses to the same **non-navigable** state — no cascade, no 403 on the whole page.
- "entity" as the informal in-map umbrella is renamed to **Map element**, freeing the word for the top-level type.
- Loading any Entity loads its whole document (Content + payload together); fine at current scale, and consistent with ADR-0002's whole-document granularity.
