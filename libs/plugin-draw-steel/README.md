# plugin-draw-steel

The bundled **Draw Steel** plugin (CONTEXT.md → Type Definition, ADR-0048/0058): the
`draw-steel.monster` Entity Type and the stat-block View that renders it — a sibling of `plugin-dnd`
with the same three-part shape. The stat block is now whole: the numeric/identity spine (#243), the
Browser facet harvest (#244), the passive **Traits** (#245), and the **Abilities** with their
render-faithful **Power Roll** tiers (#246). The block reuses the framework's Entity, Entity Type,
Field, Structured Data Type, View, and Facet as-is — no bespoke Vault Projection and no new ADR: it
projects to nested frontmatter and round-trips generically, degrading to the generic Field view with
its values intact when the operator disables the Plugin (ADR-0052/0055, root `CONTEXT.md` untouched).

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
- **Trait** — a passive property a creature always has (name + effect prose), printed above its abilities.
- **Ability** — an active action a creature takes: a signature strike, a maneuver, a triggered or villain
  action. Carries its action `type` (from `ds.CONFIG.abilityTypes`), an optional `category` (`signature` /
  `heroic` / `villain` / `maliceAncestry`) distinct from that turn slot, display `distance`/`target`, an
  optional numeric `malice` cost and `trigger`, and either a **Power Roll** or a flat `effect`.
- **Power Roll** — the 2d6 + Characteristic roll an Ability resolves through, read here as its three flat
  **tier** texts (`t1` ≤11 / `t2` 12–16 / `t3` 17+). Render-faithful, not resolvable.

Beyond the characteristics and identity, the block carries the action-economy defences a stat block prints:
`save` and `turns` (numbers) and a closed `condition_immunities` list (from `ds.CONFIG.conditions`).

The enum vocabularies (role, organization, movement type, damage type, condition, ability type, ability
category) are pinned from the Draw Steel repo's `ds.CONFIG` (branch `1.1.x`) so they match the data a bulk
import will later read.

## Stat-block shape and stance

The `draw-steel.stat-block` **Structured Data Type** is one value in the EntityDocument, three bands the
View lays out in printed-card order:

1. **Identity** — `level`, `role`, `organization`, `ev`, `keywords`, `size`. The first five **harvest**
   facet dimensions onto the Browser rail (#244), so a GM filters Monsters by what they _are_; a
   characteristic or `stamina` is a stat, never a facet.
2. **Defence / movement** — the five characteristics (`might`/`agility`/`reason`/`intuition`/`presence`,
   where the value _is_ the modifier), `stamina`, `stability`, `speed`, `free_strike`, `movement_types`,
   the minion-only `with_captain` line, and the `immunities`/`weaknesses` damage maps.
3. **Sections** — the passive `traits` list, then the `abilities` list.

**Render-faithful, flat-text tiers.** The block captures _what a printed block shows_, not a resolvable
rules engine: Hexly never rolls, so a Power Roll's tiers are prose, and an Ability's `distance`/`target`
are display strings, not typed geometry. This is a deliberate stance, not an ADR — the plugin reuses
Entity, Entity Type, Field, Structured Data Type, View, and Facet unchanged, so root `CONTEXT.md` needs
no new term. A later importer maps the Foundry pack-source onto this shape (#242).
