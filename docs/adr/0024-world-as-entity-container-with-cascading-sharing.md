# World as entity container with cascading sharing

A **World** is a lightweight container record (its own `worlds` table, not an Entity type) that groups Entities for one campaign or setting. Every Entity carries a `world_id NOT NULL` FK. World-level sharing cascades to all `shared` Entities within it via an `Entity Visibility` flag (`private | shared`, default `private`).

## Schema sketch

```
worlds:        { id, name, owner_id }
world_members: { world_id, user_id, role: contributor | viewer }
world_links:   { world_id, token }   -- World Public Link
entities:      { ..., world_id NOT NULL, is_home, visibility: private | shared }
```

A `note` Entity is auto-created alongside every new World and designated as its **Home Entity** by an `is_home` flag on the Entity (a partial unique index over `world_id` enforces at most one per World). The flag lives on the Entity — rather than a `worlds.home_entity_id` FK — so a World holds no reference back to entities: no circular FK, the home is intrinsically in-world, and World deletion cascades through `entities.world_id` without a hand-written teardown order. The Home Entity cannot be deleted or moved to another World.

The trade is that "every World has a Home" is no longer a NOT NULL guarantee but an invariant upheld at the one creation point (the World-create path always mints a Home note). The migration onto Worlds is also simpler — a World is inserted first, then its Entities reference it, with no deferred-FK dance.

## World roles

| Role | Read `shared` entities | Create entities (owns them) | Edit others' entities |
|---|---|---|---|
| Owner | ✓ | ✓ | ✓ |
| Contributor | ✓ | ✓ | ✗ |
| Viewer / Public Link | ✓ | ✗ | ✗ |

Entity-level Owner/Editor/Viewer grants (ADR-0004) remain available for finer control on top of world-level roles.

## Migration

Auto-create one World per existing user and assign all their Entities to it (`world_id NOT NULL` from the migration forward). Users can rename or split later.

## Link-picker context

The Entity link picker (ADR-0023) orders results in-world first. Off-world results display a world name suffix; in-world results show none.

## Considered Options

- **World as an Entity type (`type: 'world'`)** — rejected: a container is structurally different from content; it would bloat the closed type enum with something that has no Content, no hex grid, no tags, and no visibility of its own.
- **`world_id` nullable (worldless entities allowed)** — rejected: a nullable FK propagates a worldless code path into every query, filter, link-picker, and sharing check forever. Auto-migrating to one world per user costs nothing and eliminates the case entirely.
- **World-level sharing without a visibility flag (full cascade)** — rejected: the GM use case requires hiding unrevealed lore from players. `private | shared` per Entity is the minimum knob; it costs one column and one filter clause.
- **Per-user entity visibility at launch** — deferred: the `private | shared` flag covers the primary GM/player split. Per-member ACLs (entity visible to player A but not B) are a meaningful feature with their own UX surface; building them now is speculative.
- **Named world Editors** — deferred in favour of Contributor: "Editor" at the world level would imply edit rights over all entities in the world, which contradicts the player use case (players own what they create, not everything). Contributor is the precise term for the player role.

## Consequences

- Extends ADR-0018: `entities` table gains `world_id NOT NULL`, `is_home`, and `visibility`.
- Extends ADR-0004: Owner/Editor/Viewer on individual Entities remain; world-level roles (Owner/Contributor/Viewer) sit above them, cascading to `shared` Entities.
- Multi-world Entity membership is explicitly deferred — a "common world" is a user recipe (create a world, mark shared entities as `shared`, link it from other worlds), not a system feature.
