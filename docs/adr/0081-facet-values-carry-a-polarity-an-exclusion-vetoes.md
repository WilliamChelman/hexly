# Facet values carry a polarity; an exclusion vetoes

ADR-0035 gave the Entity list faceted filtering and stated its combining rule as "values within one Facet OR;
across Facets AND." That rule has only one polarity: every facet value a caller names is a value they want.
"Everything except the drafts" is unsayable — not in the rail, not in the URL, not on the wire — and no amount of
UI work fixes it, because the model has no way to express it. **A Facet value is now neutral, included, or
excluded**, and an exclusion **vetoes**: it outranks any inclusion of the same value, and exclusions accumulate.

Formally, a row survives a category iff `(no includes OR it carries at least one included value) AND (it carries
none of the excluded values)`. Includes still OR within a category and AND across; excludes AND with each other
and beat includes. So naming one value both ways is a contradiction that yields nothing — which is honest, and
which the rail makes unreachable by construction (see below) rather than by a resolution rule.

**Absence survives exclusion.** Exclusion is `NOT EXISTS`, so an Entity carrying no value at all for a key is
untouched by that key's exclusions: `challenge_rating:neq:5` returns every Note, Board and Asset in the World.
This is the consistent reading of a veto and it is what the `(entityId, key, value)` index gives for free. A user
who reads it as "among monsters, not the CR-5 ones" is asking for a _narrowing they have not stated_ — and can
state it, since `type:monster` plus the exclusion says exactly that. Bending the semantics to guess the
narrowing would make the same exclusion mean different things depending on what else was selected.

## The wire: mirrored `exclude*` params, and `neq` for Fields

`excludeType`, `excludeTag`, `excludeVisibility` and `excludeContainer` mirror their positive twins in
`entityListQuerySchema`, keeping the zod validation each one already has (`entityTypeSchema`, `visibilitySchema`).
Field exclusion is instead a fourth op in the token grammar that already carries one — `key:neq:value` beside
`eq|gte|lte` — because `parseFieldFilter` **drops** an unrecognised op rather than 400ing, deliberately, "so a
stale or hand-edited URL degrades to no-filter instead of breaking the browse." A URL carrying `neq` sent at an
older build degrades exactly as that comment intends.

The asymmetry — categories in separate params, Fields in the same param as their includes — mirrors the
asymmetry that is already there: categories are fixed and typed, Fields are dynamic and token-encoded. Imposing
symmetry would mean either tokenising the categories (losing their validation) or giving Fields a second param
that duplicates a grammar built to carry its own operator.

Ranges take no polarity. `-cr:gte:5` is `cr:lte:4`, and a negated bound expresses nothing a caller wants to say.

## Counts: polarity-blind drill-down, and selections are never hidden

ADR-0035's drill-down counts each category "against all other active constraints, but not its own." **"Its own"
now means both polarities.** Keeping a category's excludes applied while counting its own values would give every
excluded value a count of zero, `GROUP BY` would omit it, the rail would stop rendering the row — and the
exclusion would become **unreversible by clicking**. A one-way door in a UI whose entire premise is reversible
toggling.

Dropping both polarities is necessary but not sufficient, because a selected value can reach zero from the other
direction. Include `tag:draft`, then include `type:board`: the tag facet is counted without the tag filter but
_with_ `type:board`, so if no Board is a draft, `draft` counts zero, is dropped, and vanishes from the rail while
still filtering the list — an empty grid with nothing on screen explaining why. **This is reachable today, before
this ADR.** So: ADR-0035's "values that match nothing are hidden" is qualified — **a value the caller has
selected is always listed, whatever its count.** Unselected zero-count values stay hidden as before.

## The rail: two paired toggles, not one tri-state control

A facet row becomes an include toggle (unchanged, one click each way) plus a small, **always-rendered** `−`
control that toggles exclusion; pressing either releases the other, which is what makes the contradictory
both-selected state unreachable from the rail.

Rejected: **cycling one control** neutral → include → exclude → neutral. It taxes the dominant gesture to serve
the rare one — de-selecting would cost two clicks and _route through_ exclusion, firing a real query and flashing
a result set nobody asked for, since facet toggles are not debounced the way the search box is. It also has no
honest ARIA expression: `aria-checked="mixed"` claims _partially checked_, which is a different statement, and
screen readers will read it as such. Two `aria-pressed` buttons say what is actually true — two independent
predicates, one of which dominates.

Rejected: **hover-revealing the `−`**. It breaks touch outright and adds a surprise tab stop.

## Considered Options

- **Signed values in the existing params** (`tag=-draft`) — zero new params, and fatal: tags are free text and
  Field values are arbitrary strings, so a tag literally named `-draft` and a Field value of `-3` become
  unrepresentable. Safe for type ids alone, which makes the rule non-uniform, and a per-category escaping rule is
  worse than the param sprawl it avoids.
- **One repeatable `exclude` param of `category:value` tokens** — compact, but invents a second token grammar
  beside `field`'s and discards the per-category validation the positive params carry.
- **Within-category subtraction** (an exclusion trims its own category's includes but cannot beat an explicit
  one) — collapses into the veto for every case except `type:npc -type:npc`, where it would return npcs. There is
  no reading of that under which the caller wanted npcs.
- **Treating absence as excluded** — would make an exclusion silently narrow to "things that have this key",
  which is a second, unstated filter riding on the first.
- **Carving out `visibility`** (a closed two-value set, so `-visibility:private` is exactly `visibility:shared`) —
  rejected: the carve-out costs a special case in the rail, a rule in the parser and a sentence in the docs, all
  to suppress an affordance that is redundant rather than wrong.

## Consequences

- `entityListQuerySchema` gains four `exclude*` params; `FIELD_FILTER_OPS` gains `neq`. The envelope, cursor and
  every existing param are untouched (ADR-0025's contract holds).
- `filters()` gains a `NOT EXISTS` per category beside the existing `hasAny`; `facets()` clears both polarities
  of a category before counting it.
- The rail merges its active selections into each category's counts so a selected value is always rendered —
  which also fixes the pre-existing disappearing-selection case above, not just the exclusion one.
- Every surface that filters Entities inherits exclusion through the same params — the Entity Browser, the
  **Library**, the **Asset Browser**, and every link-target read — without any of them naming it.
- CONTEXT.md's **Facet** entry is reworded from the single-polarity rule to neutral/included/excluded with the
  veto, the absence rule, and the always-listed rule.
