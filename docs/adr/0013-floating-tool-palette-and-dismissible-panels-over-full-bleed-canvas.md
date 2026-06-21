# Floating tool palette and dismissible side panels over a full-bleed canvas

The editor body was a four-column grid — `tool-palette | canvas | inspector/regions | edge-rail` (ADR-0007) — where each side rail was a blocking column that permanently narrowed the map, and the right column was *always* showing one of Inspector/Regions with no closed state (ADR-0011). We are dissolving the side columns: the canvas goes **full-bleed**, and all side chrome **floats over it** as absolutely-positioned cards. This **partially reverses** ADR-0007's three-column shell decomposition (the components stay; their arrangement changes from grid columns to overlays) and ADR-0011's "the right column is always present."

## What we decided

- **The canvas is full-bleed; side chrome floats over it.** The header and status bar stay as docked full-width rows. Only the body changes: the canvas fills it (`1fr`), and the tool palette and the right-side panels/rail are positioned absolutely *within* the body, overlapping the map rather than reserving columns. The motivation is the recurring goal across ADR-0010/0011/0012 — keep the map maximally visible — taken to its conclusion: no chrome steals canvas width by default.

- **The left palette becomes a floating icon strip + a contextual flyout.** The strip is bare icon buttons (Select, Terrain, Feature, Label, Erase) plus undo/redo icon buttons below a divider — the old bottom-pinned History section. Arming a Tool that *has* Subtools (Terrain, Feature) opens a compact **icon-grid flyout** immediately to the strip's right; Tools with no Subtools (Select, Label, Erase) open **no flyout at all** — the one-line usage hints are dropped. The flyout is bound to the armed Tool: it is open whenever Terrain/Feature is armed and cannot be collapsed independently, because a "Terrain armed but its swatches hidden" state is a confusing dead end (keyboard `1`–`9` and the strip already cover switching).

- **The right panel gains a closed state and is dismissible.** This is the reversal of ADR-0011's always-present column. The right edge rail floats top-right (its existing role unchanged); its panel (Inspector / Regions) floats to the rail's left and is **closed by default**, opening only when there's something to show — an entity is selected (Inspector) or Regions is toggled on. With nothing selected and Regions off, only the bare rail floats and the canvas is fully clear. A rail entry toggles its panel back off.

- **Boot state is the maximally-clear map.** Opening a map shows a full-bleed canvas, the left strip with Select armed (no flyout, Select having no Subtools), and the bare right rail — nothing covering the map until the user arms a painting Tool or makes a selection. This is ADR-0010's "boot in Select," now with no chrome cost.

- **The `<1080px` rail-hiding media query is removed.** It existed to stop the blocking columns from crushing the canvas on narrow viewports. Floating + dismissible chrome solves that directly, so the editor is the same at every width rather than dropping its tools on small screens.

## Considered options

- **Keep the columns, just restyle.** Rejected: the column itself is what the change is about — a blocking rail narrows the map at every width, which is exactly the cost the floating model removes.
- **Always-present floating right panel (float, but keep ADR-0011's no-closed-state rule).** Rejected: a permanently floating Inspector showing its empty state would cover the right of the map for no benefit; the whole point of floating is to reclaim that space when there's nothing to show.

## Consequences

- **Two new glyph components** (`app-icon-undo`, `app-icon-redo`) are needed, since undo/redo were text buttons and the strip is icon-only (ADR-0007: one glyph per component).
- **A shared `appIconButton` primitive** is extracted for both the tool strip and the edge rail, replacing the edge rail's hand-rolled `.entry` button and the label/swatch/glyph-rendering `appTool` in the strip. Icon-only buttons carry `title` tooltips (`Terrain (T)`) reusing the edge rail's existing pattern, so the dropped inline labels and keycap hints remain discoverable.
- **`editor-shell` stops being a CSS grid of columns** and becomes a full-bleed canvas with absolutely-positioned overlay slots; the body's `grid-template-columns` and the `--rail-*` column widths for the sides fall away.
- **No `CONTEXT.md` change.** "Palette", "Subtool", "Inspector", and "Regions panel" keep their meanings — floating vs docked is layout, not vocabulary.
- The Region membership brush (internal `region` armed state, ADR-0012) is unaffected: the left strip highlights no Tool and shows no flyout while it is active, consistent with ADR-0012's "the palette no longer highlights any Tool while a membership brush is active."
