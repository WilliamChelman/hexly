# Regions become selectable, Inspector-owned, and subtool-free

Regions were edited entirely from the Region tool's **Subtool** panel — a legend of rows, each with a color picker, a name field, a paint/erase membership toggle, and a delete button — and were the one entity type **Select** could *not* pick. We are moving Region editing onto the universal Select → Inspector path and removing the Region tool's Subtools. This **partially reverses ADR 0010**: there the Region legend *was* the Subtool area and "painting Tools never select" was a hard rule. See `CONTEXT.md → Editing tools` (Select, Subtool, Inspector, Regions panel).

## What we decided

- **Select can pick a Region, via a repeated-click cycle.** Regions overlap freely and render only as boundary strokes (no fill, no z-order), so they can't slot into a flat precedence chain. Instead a click resolves the topmost entity and *repeated clicks at the same coordinate descend deeper* — `Label → Feature → Hex → each Region containing that coordinate (document order) → wrap`. The cycle resets on any click that lands on a different coordinate. A **Void** coordinate that sits inside a Region selects the first such Region instead of deselecting, so interior/empty cells stay reachable. We rejected border-only hit-testing (thin target; can't click a region's interior) and modifier-click (hidden gesture; the user asked the plain selector to do it) — both still need a cycle for overlap anyway, so the cycle is the primitive.

- **The Region tool has no Subtools; it creates-and-paints.** Armed with **no** Region selected, the first canvas click **mints a new Region**, adds that hex, selects it, and keeps painting onto it. Armed **with** a Region selected, clicks paint that Region's membership. The legend/subtool picker is gone. This drops the Region tool to zero Subtools (joining Select, Label, Erase) and reverses ADR 0010's "Region legend = the Region tool's Subtool area."

- **The Inspector owns Region details, and may arm the Region tool.** Name, color, delete, and an **Add ⇄ Remove** membership direction toggle live in the Inspector — the only place Region details are edited. Pressing Add/Remove **auto-arms the Region tool** on the inspected Region, collapsing select-then-edit into one gesture. This is the deliberate reversal of "painting Tools never select / Select is the only manipulation path": Select still never paints, but the Inspector can now initiate painting. Membership painting itself stays a Tool gesture (the Region tool) — it is not performed by Select.

- **A Region is born with one hex and only Delete destroys it.** Removing its last hex via the Inspector leaves an **empty Region** — still in the Regions panel, drawing nothing on the canvas — rather than auto-deleting. Conflating "trim membership" with "destroy the Region" would be exactly the silent loss ADR 0010 guarded against. `Delete`/`Backspace` on a selected Region, and the Inspector's Delete, are the only ways a Region ceases to exist, each one undoable step.

- **A right-edge icon rail opens a Regions panel that shares the Inspector's column.** The rail's first entry lists every Region (swatch + name, including emptied/invisible ones) with a New Region action. Selecting a Region from the list is identical to selecting it on the canvas and flips the shared column to the Inspector. The rail is built to take further entries later.

- **The selected Region is shown by a translucent member-hex fill** (plus its normal border), so membership is legible cell-by-cell during Add/Remove editing. Unselected Regions stay border-only, so the map isn't washed in color.

## Consequences

- The `Selection` union gains a `region` kind, and selection resolution gains a per-coordinate cycle index that resets on coordinate change. `select()` must enumerate the Regions containing a coordinate in document order.
- The renderer gains a Region selection highlight (translucent member-hex fill) and the canvas/store a way to enumerate Region membership at a coordinate; no new geometric hit-test is needed (membership is a coordinate lookup).
- The Region branch of the Subtool palette is deleted; `1`–`9` do nothing while the Region tool is armed (consistent with Select/Label/Erase).
- The Inspector grows a Region editor (name, color, delete, Add/Remove) that can change the armed tool — the first control outside the palette permitted to arm a Tool.
- A new right-edge rail + Regions-panel view is introduced, sharing the Inspector column.
- Empty Regions are now a reachable state, visible only in the Regions panel — UI that lists Regions must not assume non-empty membership.
