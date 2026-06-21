# Two-level Tools (Tool → Subtool) and a universal Select tool

The editor's armed state was a flat tagged union (`terrain`/`erase`/`feature`/`clear-feature`/`region`/`label`), rendered as one long palette with every terrain, feature, and region as a sibling button. We are restructuring it into a **two-level model**: a top-level **Tool** (Select, Terrain, Feature, Region, Label, Erase) plus, for Tools that have them, a **Subtool** (which terrain, which feature, which region). See `CONTEXT.md → Editing tools`.

## What we decided

- **The two levels are real state, not just a palette grouping.** The armed state is a Tool plus its current Subtool; the canvas dispatches on the Tool. We rejected a UI-only accordion over the existing flat union because the payoff — "remember the last Subtool per Tool" and a clean top-level mode switch including Select — only falls out if the two levels actually exist in state. The cost is a real refactor of the `Tool` union, `applyAt`, the palette, and the keyboard handler.

- **Select is universal and the *only* selection path.** It selects the topmost entity under the cursor (precedence **Label → Feature → Hex**; a Void coordinate selects nothing), opens it in the inspector, deletes it (`Delete`/`Backspace` → label/feature/hex deletion), drags a Label to move it, and drags a **whole Hex** (terrain + feature) to another coordinate. This replaces the old ambient behaviour where clicking a Label selected it under *any* tool — painting Tools no longer select anything; a Label is inert to them.

- **Erase is its own Tool; Clear is a Subtool of Feature.** Erase deletes the entire Hex record (terrain *and* feature), so it is broader than terrain and cannot be a "blank terrain" Subtool. Clear-feature is scoped to the feature layer, so it lives among the feature Subtools.

- **Moving a Hex carries content only, and overwrites on drop.** A dragged Hex moves its terrain + feature; **Region membership stays at the origin coordinate** (regions are a location overlay, not a property of the painted cell). Dropping onto an occupied coordinate **overwrites** it (origin → Void); one undo restores both ends, so there is no silent loss.

- **Boot in Select.** A map opens armed with the non-destructive Select tool, so a stray click never lays down terrain — even on a map you opened only to read.

- **Subtool memory is session-only.** The remembered Subtool-per-Tool is in-memory editor state — not in the `HexMap` document, never undone, saved, or restored across reloads — the same category as the armed tool itself. Cold-start defaults: Terrain → `forest`, Feature → first feature, Region → none until picked.

## Consequences

- The Region legend is no longer always on screen — it is the Region Tool's Subtool area, shown only while Region is armed.
- Keyboard model changes: letters arm Tools (`S` Select, `T` Terrain, `F` Feature, `R` Region, `L` Label, `E` Erase); `1`–`9` pick the *nth Subtool of the armed Tool*, instead of `1`–`9` hardwired to terrains globally.
- The renderer gains a selection highlight (outline on a hex/feature, bounds on a label).
