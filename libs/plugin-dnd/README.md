# plugin-dnd

The bundled D&D plugin (CONTEXT.md → Type Definition, ADR-0048, #192): the `dnd.monster` Entity Type
and the stat-block View that renders it.

Two entry points, because a plugin's halves have different consumers:

- `@hexly/plugin-dnd` — framework-free: the type's id, label, and Field schema, plus the stat-block
  rules (ability modifiers). The API imports this to validate and facet a monster, and must never see
  Angular.
- `@hexly/plugin-dnd/web` — the Angular half: the type's chrome (icon, transloco keys, Views) and the
  `StatBlockView`. It depends on `@hexly/web-entity` (the `ENTITY_SESSION` contract) and
  `@hexly/web-ui`, never on `apps/web`, so the app composes the plugin rather than hosting it.

A second plugin (`pathfinder.monster`) would be a sibling lib, listed alongside this one in the
`bundled-*` files of the app and the API.
