# Hex name field, rendered minimally and distinct from a Label

A Hex gains an optional `name` (`hex = { terrain, feature?, name? }`) so a coordinate can be titled — a named village, a named pass — without resorting to a free Label. Only a painted Hex can carry one; the existing move path already deep-clones the whole record, so the name travels with its content (and survives a swap) for free.

## Why a name when Labels already exist

A Label is free-positioned cartographic typography placed and styled by hand; it is bound to no cell. A Hex name is *structured metadata bound to its coordinate*: it travels on move/swap, is edited in the Inspector, is searchable, and the renderer draws it automatically. We keep that line crisp by making the name deliberately minimal — small text anchored to the hex (below the feature icon, or hex-centre for a bare named hex), always visible, with no size/rotation/offset controls. Those stay Label-exclusive, so a Hex name never grows into a second, competing Label system.

## Consequences

- `hexSchema` gains `name?`; documents saved before it parse unchanged (optional field).
- The Inspector's Hex/Feature panel gains a Name input.
- The renderer draws the name; an absent or empty name draws nothing. Clearing a Hex's feature leaves its name (the two are independent fields); Erase removes the whole record, name included.
