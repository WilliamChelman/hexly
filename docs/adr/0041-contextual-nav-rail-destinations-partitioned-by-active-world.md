# The nav rail's destinations are contextual, partitioned by the active World

The nav rail shows **World-scoped destinations only inside a World and instance-scoped destinations only outside one**. The pivot is the active World (ADR-0028) — a URL fact, `null` on the World Index (`/`) and set under `/w/:worldId` — so the partition is a read of one existing signal, not new state:

- **Inside a World** (`activeWorld.worldId()` set): the **World Switcher** at the masthead, **Library** (`/w/:worldId/entities`), and **World Settings** (`/w/:worldId`, the owners page). World Settings is gated on the World's `manage` right — the same `rights` the World Index reads to gate its own settings entry (ADR-0039), not a separate lookup.
- **Outside a World** (the Index): **Styleguide**, and **Admin** when the caller holds it (`canAdminister()`, ADR-0037). No Switcher — the Index _is_ the World chooser, so a quick-hop control there is redundant.

This replaces a flat rail that showed every destination at every location: Library (pointing back at the Index when no World was open), Styleguide, and Admin, with the Switcher above them. That mixed altitudes — a World-scoped rail carried instance links, and the Index's rail carried World links that pointed nowhere useful — so the rail never read as "about the thing you're in." Partitioning makes each context's rail name only what that context can act on.

## Consequences

- **Library loses its Index fallback.** It rendered at every location, aiming at `/w/:worldId/entities` inside a World and falling back to `/` (with an `exact` active-match) outside. It now renders only inside a World, always `/w/:worldId/entities` — the fallback branch and its `exact` flag are gone.
- **World Settings becomes reachable from inside its World.** Previously it was reached only from a World Index card (`/w/:worldId`); once inside a World there was no rail link to it, and switching Worlds lands on the Entity Browser, not settings. It now sits in the inside-World rail, gated on the `manage` right so non-owners never see it (the server re-checks regardless).
- **Admin and Styleguide leave the rail while inside a World**, so they need a context-independent path. A `>`-prefix Command-Palette Provider (ADR-0032) supplies **Go to Admin** (gated on `canAdminister()`) and **Go to Styleguide** — reachable from anywhere, inside a World or not. The brand logo remains the always-present route back to the Index, where both reappear in the rail.
- **A non-admin on the Index sees a near-empty rail** (brand, Styleguide, avatar). Acceptable: the Index is a chooser and its own content is the World list — the rail is not carrying its weight there, and manufacturing entries to fill it would re-mix altitudes.
- The partition is a pure function of `activeWorld.worldId()` and the caller's rights; there is no remembered "nav mode" to keep in sync, and multi-tab stays coherent because each tab's rail follows its own URL.
