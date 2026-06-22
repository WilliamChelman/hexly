# Multi-selection, Select Subtools (Pick/Marquee), and swap-based moves

Status: accepted (amends ADR-0010)

The Select tool grows from a single-entity picker into a multi-selection editor, and a Hex move stops silently overwriting its destination. This amends ADR-0010 on two points: *"Select … has no Subtools"* and *"Moving a Hex … overwrites on drop."*

## What we decided

- **Selection is a set, not a single ref.** Select holds zero or more entities (Hexes, Features, Labels, Regions). Cmd/Ctrl-click toggles the topmost entity at a coordinate; Shift-click toggles the whole stack there (adds the missing members, or removes them all if the pile is already fully selected); a plain click replaces the set with the topmost and still cycles deeper on repeat; a plain click on empty space clears the set.

- **Select gains two Subtools: Pick and Marquee.** Pick is the click/cycle/move plus modifier-select behaviour. Marquee drags a rectangle to select the Hexes and Labels within it — the answer to box-selecting on a *densely-painted* map, where there is no empty space for a drag-to-select to begin. Marquee excludes Regions (no single position). This contradicts ADR-0010's "Select has no Subtools"; the two-level model from ADR-0010 absorbs it cleanly (keyboard `1`/`2`, palette keycaps, per-Tool Subtool memory, boot in Pick).

- **A move never silently destroys content.** A single Hex dropped onto an occupied Hex now **swaps** the two whole records (terrain + feature + name) rather than overwriting; Region memberships stay at both coordinates, as before. This replaces ADR-0010's overwrite-on-drop.

- **A group move is a rigid translation by one offset, applied per entity.** Each selected Hex's content moves by the offset; each Label by the equivalent pixels; each selected Region's *membership footprint* shifts by the offset. "Regions stay put on a move" is now just the special case of moving a Hex without its Region selected. The offset snaps to hex steps whenever any Hex or Region is selected (Labels ride along by that delta); a Labels-only move is free pixels. Intra-group overlaps are not collisions — sources are snapshotted, cleared, then written.

- **Group collisions with non-selected hexes resolve by pairwise inverse swap, per cell.** A destination occupied by a hex *outside* the selection displaces that occupant by the inverse offset (`d − offset`). Where that target is free, the occupant swaps there; where it is occupied by the moving group (a short nudge that overlaps its own path), that cell blocks and the whole move is refused, highlighted live during the drag. Clean pick-up-and-drop-elsewhere moves swap fully and non-destructively; only genuinely ambiguous self-overlapping nudges block.

- **The Inspector reflects the set.** One entity selected → its full editor (unchanged). Two or more → a count and breakdown plus Delete all. Delete removes every selected entity in one undo step, each per its kind (Hex → erase record, Feature → clear feature, Label → remove, Region → destroy).

## Considered options

- **Move conflict — overwrite (status quo) / confirm dialog / swap.** Overwrite silently loses a now-named hex; a confirm dialog adds modal friction and infrastructure the editor lacks. Swap is reversible in one undo, needs no modal, and previews both ends during the drag.

- **Group collision — block-all / overwrite-with-confirm / pairwise inverse swap.** Block-all is predictable but one stray hex refuses an otherwise-fine drop; overwrite-with-confirm is destructive. Pairwise inverse swap keeps the non-destructive swap principle and degrades to a per-cell block only where the geometry is genuinely ambiguous.

- **Region in a group move — footprint translates / rigid body with content / regions don't move.** Footprint-translation is the only option orthogonal to the existing model; selecting a Region's hexes *and* the Region together (one Shift-stack click per cell) reproduces the rigid-body result by composition, without special-casing Regions.

## Consequences

- `Selection` becomes a collection; the cycle logic, Inspector, renderer highlight, and delete path all generalise to a set.
- The renderer previews swaps and highlights blocked cells live during a drag.
- ADR-0010's overwrite-on-drop and "Select has no Subtools" no longer hold; see this ADR.
