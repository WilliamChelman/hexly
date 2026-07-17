# Structured Data Types harvest facet dimensions

ADR-0054 (line 62) and CONTEXT.md stated flatly that a **structured Data Type is never facetable** — "it
has no discrete values to count." That held only because a structured value was opaque to the facet
pipeline, the same way it was once opaque to search and link-graph extraction before `extractText` and
`harvestEdges` gave a structured type a way to _emit_ derived signal from its inner value. Faceting had no
such hook, so collapsing a set of scalar Fields into one structured value silently dropped every facet
they carried. This blocked the natural fix for a real gap: a bespoke, laid-out View (a D&D stat block)
is a **Type-contributed** view bound to a _type_, not a Data Type — so a user-defined type or a
field-laden Entity could never afford one. Remodelling the stat block as a **Structured Data Type** makes
it attachable and auto-affording (ADR-0054's existing mechanism), but only if faceting survives the
collapse.

## Decision

**A structured Data Type may harvest facet dimensions from its value, mirroring `harvestEdges` /
`extractText`.** The "never facetable" invariant is refined, not abandoned: a structured **Field** is
still never _directly_ facetable — you do not count the opaque blob — but its **Data Type** may _harvest_
facet dimensions from the value. Faceting for a structured value is driven by the Data Type, never by the
Field's `facetable` flag.

- **Static declaration — `facetDimensions: { key, labelKey, dataType }[]`** on the Structured Data Type
  supplies each dimension's identity (the facet `key`), its i18n label, and its control type (the rail
  picks value-toggles for enum/string, a range for number/date). This is the label/control source the
  read path lacks for a value that maps to no scalar Field.
- **Per-value harvest — `harvestFacets(value): { key, value, num }[]`**, keys drawn from the declared
  dimensions, wrapped in `defineStructuredDataType` with the same `safeParse → []` forward-only
  degradation as the other hooks.

**Shared key namespace, scalar wins.** Harvested dimension keys share the flat facet `key` space with
scalar Fields' document keys. Deliberate reuse of a key _merges_ into one facet bucket — a feature, not a
clash. When a key is claimed by both a scalar Field and a structured dimension, the scalar Field wins the
label/control (it is the direct lens over an actual document key).

**First user: `dnd.stat-block`.** The D&D stat block becomes a Structured Data Type whose value is the
whole block; the 13 scalar monster Fields retire and `dnd.monster` references the one structured Field
plus `core.content`. It declares three dimensions — `size`, `creature_type`, `challenge_rating` —
matching the `facetable: true` set the scalar Fields carried (`challenge_rating` numeric, so its `num` is
populated and its range filter is preserved). Attaching `dnd.stat-block` to any type or Entity
auto-affords the stat-block View. No data migration (pre-production).

## Consequences

- **Supersedes ADR-0054's line 62** and rewords CONTEXT.md's **Field** and **Structured Data Type** from
  "never facetable" to "not _directly_ facetable, but may _harvest_ facet dimensions."
- **`deriveFieldFacets` gains the `dataTypes` set** (it takes only `(fields, doc)` today, unlike
  `deriveSearchText` / `harvestEdges`) and a parallel walk over the effective structured Fields calling
  `harvestFacets`, merged into its output.
- **The read/label path gains a second source.** `facetableFieldsByKey` (server) and the facet rail
  (client) resolve a present facet `key` to a scalar Field _or_ a registered `facetDimensions` entry. A
  pre-existing quirk surfaces here: scalar facet labels render untranslated while dimension `labelKey`s
  are i18n — unified onto the translated path as dimensions are wired in.
- **Vault:** `dnd.stat-block` projects as one `frontmatter` value (nested under `stat_block:`);
  recognition of externally-authored _flat_ stat-block frontmatter on import is deferred (custom
  `toMarkdown`/`fromMarkdown`), revisited only if external stat-block import becomes a goal.

## Considered Options

- **Let a user-defined type place the existing `dnd.view.stat-block` id** — rejected: the view hard-codes
  D&D document keys, so it would couple user data to plugin internals and render nothing for a user's own
  keys.
- **Keep the 13 scalar Fields and add the structured type alongside** — rejected: two editing paths for
  one dataset, redundant rail surfaces, and double-counted facets.
- **Self-describing harvest rows `{ key, label, dataType, value, num }`** (no static declaration) —
  rejected: repeats label/control metadata on every value row and bloats the facet index; the static
  `facetDimensions` declaration is the natural mirror of `valueSchema`.
- **A distinct key namespace for harvested dimensions** — rejected in favour of the shared space, which
  makes deliberate key reuse merge into one facet and keeps the single flat `key` column.
