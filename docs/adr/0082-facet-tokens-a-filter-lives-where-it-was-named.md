# Facet Tokens: a filter is named inline or clicked, and lives where it was named

Faceted filtering (ADR-0035, ADR-0048, ADR-0055) reaches a caller only where a Facet rail is rendered — the
**Entity Browser**, the **Library**, the **Asset Browser**. The **Command Palette** and every picker built on
`EntitySearchPickerComponent` have a bare text box, so on those surfaces the filters exist on the wire and are
unreachable by a human. **A Facet may now be named inline, as a `$`-prefixed token in any Entity search box** —
`$type:npc`, `-$tag:draft`, `$cr:>=5` — parsed client-side into the structured params that already exist.

The load-bearing decision is not the grammar. It is **where a named filter lives**: a typed Facet lives in the
text, a clicked Facet lives in the rail, and neither store ever writes into the other except to delete. Typing
never rewrites the box; clicking never fills it.

## Two stores, one rule

Filter state is `parse(text) ∪ railState`. The rail displays the union; each value has exactly one visual state.
Three properties fall out, and each was a hard requirement:

- **The text is never taken from you.** It is parsed live and never absorbed, rewritten, or turned into a widget,
  so backspace works the way backspace works. Fixing a typo'd `$tag:fantsy` is four backspaces.
- **The rail never writes text.** A clicked Facet lands in the rail, so the searchbar cannot accumulate machine
  strings, and a Field range or a Container selection — which have real controls and no good textual rendering —
  never appear as text at all.
- **Everything applied is reversible where it was named.** A rail row whose value came from the text renders as
  query-owned; clicking it deletes _that exact token_ from the box. This is the only rail→text write in the
  design, it is a deletion, and it removes text the caller typed themselves.

Where both stores name the same value, **the text wins** and the rail's own entry is dropped, so a contradiction
resolves visibly at the moment of typing rather than as a silent empty result set.

On a surface with no rail the text store is simply the only store — (vii) degrades without a special case, and a
filter is reversed by backspacing it.

The URL needs no new shape: `entity-browser.page.ts` already reads `q` **and** `type`/`tag`/`visibility`/`field`
as separate keys. Text store → `q`; rail store → the facet params. (URL `q` is the raw typed string; wire `q` is
the residual free text after tokens are stripped — same key, two contents, worth naming apart in code.)

## `$` marks a Facet, and the key space is open

Every token carries the `$`, the reserved names included: `$type`, `$tag`, `$visibility`, `$in` (Container), and
any Facet key — Field ids and the dimensions Structured Data Types harvest (ADR-0055). One rule: **`$` starts a
Facet, everything else is text.**

Uniformity is what makes the feature discoverable. Pressing `$` reveals the _entire_ filter vocabulary in one
list, which is the single gesture that answers "what can I even filter by?" — the gap that leaves inline query
syntax undiscovered in most applications. If the common four were also typeable bare, `$` would reveal only part
of the vocabulary and the model would split.

It also removes every prose heuristic. Entity prose is full of colons — "Session 4: the ambush", a URL, a time —
and with a bare `key:value` grammar over an _open_ key space, whether `sea:storms` is a filter would depend on
which Fields happen to exist in this Container right now, so the same string would mean different things in two
Worlds and a Field created tomorrow would silently reinterpret a query that worked today. With `$`, an
unresolvable key is a **stated miss** ("no Facet `domain` here"), never a silent reinterpretation. That turns the
cost of an open key space from invisible to legible, which is what makes the open space affordable.

Negation is outermost (`-$tag:draft`) so it composes with any key. Values are bare unless they need quoting
(`$tag:"sea of storms"`); an unquoted comma ORs (`$tag:a,b`) and a quoted one is literal. Comparisons are written
as comparisons (`$cr:>=5`) and mapped onto the wire's `gte`/`lte`; the caller never meets the encoding. There is
no escape character: a value containing a double quote is untypeable and remains clickable in the rail, which is
a fair trade against a backslash rule nobody remembers. Values match **exactly, including case** — typeahead
inserts the stored value verbatim, rather than the parser case-folding and thereby disagreeing with the rail.

## Keys resolve synchronously; values only suggest

The key set comes from the **client registry** — `TypeRegistry.availableFields()` plus statically declared
`facetDimensions` — never from the facet read. A parser that changes its mind when a network read lands is a
parser that rewrites results while they are being read; that is the worst failure available in a design that
reparses on every keystroke. The facet read feeds **value suggestions and counts only**, so a late response can
make a filter easier to type but can never change what it means.

Reserved names win at resolution: a World Field labelled "Type" does not take `$type`, and is addressed by its
full key.

Parsing is therefore **scope-dependent** — `$domain:` resolves where that Field is defined and reports a miss
where it is not. Acceptable because the browse surfaces are already World-scoped in their URLs, so the scope
travels with the link, and because ADR-0083 gives the Palette a World too.

**A token applies as soon as it parses** — no caret tracking, no conditional on the value being known. The cost
is a brief filter by `$tag:fan` while typing `fantasy`; the existing 150ms debounce means continuous typing never
fires it, and the browser deliberately keeps prior rows on a query change rather than clearing.

## Surfaces, and where typeahead degrades

All six families get the language: the three browse surfaces, the `EntitySearchPickerComponent` family (the `@`
picker, the Entity Link Field picker, the Board **Embed** picker, the relink popover), the asset and Board
**Image** pickers, and the Palette. **Key typeahead everywhere** (synchronous, off the registry). **Value
typeahead wherever a facet read already runs** — which is everywhere except the Palette, and costs nothing new:
`containerFacet` already calls `entities.facets(...)` on every picker and discards the `type`/`tag`/`visibility`/
`fields` that come back in the same response. The Palette gains no facet read of its own; its scope makes five
`GROUP BY`s per keystroke the one place the cheap thing is not cheap.

The suggestion list claims ↑↓/Enter/Esc through an **element-level `keydown` on its own input**, stopping
propagation before ADR-0063's window listener. A deliberate deviation: ADR-0063 eliminated _window-wide_
listeners that could not see each other or an open dialog. Registering on the `editable` layer instead would make
the Palette need a `when()` gate referencing the suggestion list's open state — coupling two components that
should not know each other, achieving the opposite of that ADR's goal. An element-scoped handler bounded by focus
resolves precedence by DOM order and needs no such gate.

## Considered Options

- **The text is the filter state** (one string, server parses, rail rewrites the text) — rejected: it pollutes
  the searchbar, and worse as Facets get richer, since a range or a Container has no good textual rendering. It
  also forces label→id resolution on every keystroke for a string that must mean the same thing tomorrow, and
  would require partially unwinding `toFtsMatch`'s guard, which strips non-alphanumerics precisely so query
  syntax cannot be injected into FTS5.
- **Typed tokens commit to chips in the input** — rejected: chip mechanics interrupt exactly the uninterrupted
  typing this exists to enable, with focus handling and tab-out.
- **Typed tokens are absorbed into the rail on the following space** — rejected outright: a typo commits before
  it can be fixed, and backspace then edits the wrong thing.
- **Text and rail as two fully independent stores, ANDed** — rejected: a rail row for a typed value either
  renders active and does nothing when clicked, or renders inactive and lies about the filter in force. There is
  no third answer, and `-$tag:draft` against a rail-included `draft` would yield zero results with nothing on
  screen explaining which of the two visible controls caused it.
- **A fixed vocabulary of four keywords, Fields rail-only** — rejected once `$` removed the prose ambiguity that
  was the argument for closing the set.
- **Suggestions accepted by Tab and click only** — no keyboard contention, but Tab is itself a claim on a key
  with an established meaning, so it buys no neutrality and costs the expected gesture.

## Consequences

- A shared parser in `libs/domain` turns a raw box string into `{ q, ...filterParams }`; it takes its key set as
  an argument, so no surface's vocabulary is hard-coded and the Palette's smaller one needs no special case.
- A shared search-input component owns the suggestion list, its keyboard, and the two-stage (key, then value)
  typeahead. Every one of the six surfaces adopts it.
- The rail gains a query-owned rendering for values sourced from the text, and clicking one edits the box.
- Nothing changes on the server. Every token maps onto params that already exist or that ADR-0081 adds.
- CONTEXT.md gains **Facet Token** and records the where-it-was-named rule.
