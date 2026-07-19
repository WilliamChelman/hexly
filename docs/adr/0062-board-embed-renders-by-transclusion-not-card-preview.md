# Board Embed renders another Entity by transclusion, not a card preview

The **Board** (`core.board`) affords an **Embed** Board Element that shows another Entity on the surface. We decided an Embed renders its target by **full live transclusion of a per-Embed-chosen View** — the target's actual View rendered in place — rather than a business-card chip (name + icon + snippet). The card representation still exists, but only as the _fallback_ rendering; transclusion is the primary behaviour because the point of a Board is to compose real entities visually, not to link to them.

## Considered Options

- **Card preview** — an Embed shows a compact card (the same one the Entity Browser draws), always click-through to the full Entity. Cheap, reuses existing card machinery, and a Board-in-a-Board is just a card so there is no recursion problem. Rejected as the _primary_ behaviour: it does not deliver "see your entities composed on a surface," only "see links to them."
- **Full live transclusion (chosen)** — the target's chosen View is rendered in place, live-following its committed changes, access-filtered per viewer. Far more powerful, at the cost of recursion, performance, and nesting-depth concerns that must be bounded explicitly.

## Consequences

- **Recursion must be bounded.** An Embed render path carries the ancestor Entity-id chain; a target already in the chain is a cycle and stops. Independently, a **configurable maximum render depth** (Instance Configuration, `features.plugin.board.maxEmbedDepth`, default 3) caps nesting. Past the cap, at a cycle, or when the chosen View cannot render (its Field gone, its Plugin disabled, target unreadable/deleted), the Embed **degrades to the card preview** — so choosing transclusion does _not_ retire the card; it demotes it to the fallback.
- **An Embed is an Entity Link.** It emits a link edge (harvested by the `core.board-surface` Data Type), appears in the World Graph, and resolves per viewer through the access filter — an unreadable or deleted target shows a dangling, non-navigable placeholder.
- **Transclusion is read-only.** An Embed is static until clicked, when it **arms** for read-interaction only (pan, scroll, click-through) — one armed element at a time, like an armed Tool. Editing a transcluded target's substance is never done through the Embed; it requires opening the target. In-place editing is explicitly deferred ("more might come").
- The Board plugin's `-web` half must be able to render _any_ registered View, so it depends on the View registry rather than any one plugin's renderer.
