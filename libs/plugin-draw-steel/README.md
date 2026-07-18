# plugin-draw-steel

The bundled **Draw Steel** plugin (CONTEXT.md → Type Definition, ADR-0048/0058): the
`draw-steel.monster` Entity Type and the stat-block View that renders it — a sibling of `plugin-dnd`
with the same three-part shape. This first pass (#243, the "spine") is the **numeric/identity half** of
the stat block; Traits, Abilities, and the Browser facet harvest are deliberate follow-ups (#242).

Three entry points, because a plugin's halves have different consumers:

- `@hexly/plugin-draw-steel` — framework-free: the `draw-steel.monster` type, the
  `draw-steel.stat-block` Structured Data Type and its Zod `valueSchema`, its Field, and the per-stat
  render descriptors. The API imports this to validate a Monster, and must never see Angular.
- `@hexly/plugin-draw-steel/server` — exposes exactly one `serverPluginDrawSteel()`, the mirror of the
  web provider. It names the type, the stat-block Field, and the Data Type; it never imports Angular.
- `@hexly/plugin-draw-steel/web` — the Angular half, exposing one `providePluginDrawSteel()`. It
  registers the type, the stat-block View (behind `loadComponent`, so its body stays off the initial
  bundle), the `draw-steel.*` translations, the `swords` glyph, and the Data Type.

`@hexly/plugin-draw-steel/testing` exports the translation catalogs as synchronous JSON, for the app's
shared transloco test setup — test-only, never reachable from the app bundle.

## Draw Steel glossary

A Draw Steel creature reads differently from a D&D one; the stat block captures **what a printed block
shows**, not a resolvable rules engine (a later importer maps Foundry pack-source onto this shape, #242).

- **Characteristic** — one of the five scores a creature rolls with: Might, Agility, Reason, Intuition,
  Presence. The value _is_ the modifier (there is no derived `+N`, unlike a D&D ability score).
- **Stamina** — how much punishment a creature takes before it drops (Draw Steel's hit points).
- **Size / Stability** — a printed size token (`1S`, `1M`, `1L`, `2`, …) and a forced-movement resistance.
- **Save threshold / Free strike** — the roll a save needs, and the flat damage of an opportunity strike.
- **Speed / Movement types** — the distance and the kinds of movement it applies to (walk, climb, fly,
  burrow, swim, teleport).
- **Immunities / Weaknesses** — per-damage-type modifiers (acid, cold, corruption, fire, holy,
  lightning, poison, psychic, sonic).
- **Role** — a creature's tactical function (Ambusher, Artillery, Brute, Controller, Defender, Harrier,
  Hexer, Mount, Support).
- **Organization** — how it fields in an encounter (Minion, Horde, Platoon, Elite, Leader, Solo).
- **Level / EV** — its level and Encounter Value, for budgeting an encounter.
- **Keywords** — free-form tags grouping a creature (humanoid, goblin, undead, …).

The enum vocabularies (role, organization, movement type, damage type) are pinned from the Draw Steel
repo's `ds.CONFIG` (branch `1.1.x`) so they match the data a bulk import will later read.
