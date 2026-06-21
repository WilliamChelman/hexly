# Region creation is panel-only; the Region tool leaves the palette

The Region tool earned its palette slot by doing two jobs (ADR-0010, ADR-0011): armed with no Region selected it **create-and-painted** a fresh Region on the first click; armed with one selected it **painted that Region's membership**. Issue #39 then gave Regions a panel with a **New Region** action that mints an empty "Region N", selects it, and arms it in Add — i.e. it now does the create-and-paint job, minus the surprise. With creation living in two places, the Region tool's first job is redundant, and a palette button whose only remaining behaviour needs a prior selection is a confusing dead state when nothing is selected.

We are removing the Region tool from the palette. Creation happens **only** through the Regions panel; membership painting stays a canvas gesture, but `region` survives **only as an internal armed state** that the Inspector's Add/Remove toggle sets. This **reverses** ADR-0010's "Region is a top-level Tool" / `R`-arms-it, and **completes** ADR-0011's move of Region editing onto Select → Inspector by removing the last palette affordance for Regions. See `CONTEXT.md → Editing tools`.

## What we decided

- **Creation is panel-only.** The Regions panel's New Region is the single way to mint a Region (ADR-0011, issue #39). It mints an empty "Region N" with the next palette colour, selects it (opening the Inspector to name it), and arms it in Add — so the very next stroke paints into it, preserving the fast "create then draw" flow the Region tool used to give, in the same click count.

- **The Region tool leaves the palette.** `Region` is no longer one of the palette's armable Tools, and `R` no longer arms anything. The palette's Tools are now Select, Terrain, Feature, Label, Erase. We rejected keeping the button as a membership-only brush: armed with nothing selected it would do nothing, which is exactly the dead-tool state a palette entry should never present.

- **`region` survives as an internal armed state, set only by the Inspector.** The `ToolId` union keeps `region`, the canvas still dispatches on it, and `applyAt` still paints the selected Region's membership per the Add/Remove direction. But the **only** thing that arms it is the Inspector's Add/Remove toggle (`armRegionDirection`) on the selected Region — the control ADR-0011 already made "the first control outside the palette permitted to arm a Tool." So the membership brush is reached exactly one way: select a Region (canvas or panel) → Inspector → Add/Remove → paint.

- **Armed with no selected Region, a Region stroke is a no-op.** Removing create-and-paint means the canvas no longer mints on a stroke. If `region` is somehow armed with nothing selected (e.g. the selection was cleared while the brush stayed armed), a stroke does nothing rather than silently minting a Region — the surprise-creation ADR-0011 already worried about, now closed.

## Consequences

- `createAndPaintRegion` is deleted; its auto-naming/colour logic already lives in the shared `nextRegionIdentity` that `newRegion` uses, so numbering (next unused "Region N", a deleted number not reused) is unchanged and still covered.
- The palette `TOOLS` table drops its `region` row and the `r` keyboard binding is removed; `1`–`9` already did nothing for `region`. The palette no longer highlights any Tool while a membership brush is active — the Inspector's Add/Remove is the active affordance.
- `armTool` still accepts `region` as a generic state setter, but nothing in the UI calls it with `region`; the Inspector's `armRegionDirection` is the live path.
- The Region select-cycle (ADR-0011) and the translucent member-hex highlight are unaffected: selection, not the palette, is what reaches a Region.
- Tests and journeys that seeded a Region by arming the palette Region tool now seed it via the panel's New Region; the membership-brush tests, which already arm `region` directly, stand.
