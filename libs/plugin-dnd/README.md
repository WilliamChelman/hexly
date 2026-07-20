# plugin-dnd

The bundled D&D plugin (CONTEXT.md → Type Definition, ADR-0048, #192): the `dnd.type.monster` Entity Type
and the stat-block View that renders it.

Two entry points, because a plugin's halves have different consumers:

- `@hexly/plugin-dnd` — framework-free: the type's id, label, and Field schema, plus the stat-block
  rules (ability modifiers). The API imports this to validate and facet a monster, and must never see
  Angular.
- `@hexly/plugin-dnd/web` — the Angular half, which exposes exactly one thing: **`providePluginDnd()`**.
  The web app names it in `app.config.ts` and knows nothing else about this lib. It depends on
  `@hexly/web-entity` (the `ENTITY_SESSION` contract, `providePlugin()`) and `@hexly/web-ui`, never on
  `apps/web`, so the app composes the plugin rather than hosting it.

That one provider partitions the plugin's contributions itself: the type into the root `TypeRegistry`,
the stat block into the `ViewRegistry`, `dnd.*` into the app's vocabulary. The View is declared with
`loadComponent` (the idiom an Angular `Route` uses), so its id and label register eagerly — the entity
header can draw the view toggle without fetching anything — while `StatBlockView` stays in its own
chunk until a monster is first opened. `nx build web` lists it as a `stat-block-view` chunk.

`@hexly/plugin-dnd/testing` exports the translation catalogs as synchronous JSON, for the app's shared
transloco test setup — test-only, and never reachable from the app bundle.

A second plugin (`pathfinder.type.monster`) would be a sibling lib exporting its own `providePluginX()`: one
more line in the app's `app.config.ts`, and one more entry in the API's `bundled-plugins.ts`.
