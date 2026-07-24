# System-managed type and field definitions, enforced at the write choke point

ADR-0065 registered `core.type.asset` and `core.field.asset` as ordinary plugin definitions, so every shape-editing surface offered them: the add-type picker listed the asset type, the attach-field picker listed the asset-ref field, and nothing stopped a user (or raw API call) from _removing_ them — leaving bytes on disk that no Entity claims, unreachable by delete and unaccounted by Reindex. We introduce **System-managed**, a semantic marker on a Type Definition or Field meaning _the system alone assigns and removes it, in both directions_ — and we enforce it at the entity write choke point (ADR-0045), not merely in the UI. `core.type.asset` and `core.field.asset` carry it.

## Decisions & consequences

- **One semantic marker, not per-surface booleans**: the marker names what is true of the definition (minted and owned by the upload path, never authored), and surfaces _derive_ behavior from it — pickers don't offer it, remove/detach affordances don't render, the write path rejects changes to it. A new surface gets the rule by consulting one flag instead of remembering which of several UI booleans applies.
- **Server-enforced**: the write choke point diffs the incoming types set and attached-fields set against the current one and rejects user-initiated adds/removes of System-managed entries. UI hiding alone is a courtesy; deletion semantics and the `assetIndex` rebuild (ADR-0065) depend on "asset identity is never stripped" as an invariant. Upload/mint, importers, and Reindex assign it through the internal service path.
- **Shape, not value**: the marker governs the types set and the attached-fields slot, never the value at the document key — guarding values would mean validating every write's document body, a far bigger machine than this needs, and `core.field.asset`'s value is already unreachable for hand-editing (structured, no inline control).
- **Visible, affordance-less**: the Details panel still lists a System-managed type and field — no remove ×, no detach — because its contract is showing the Entity's shape; users don't author the marker, but they can see it.
- **The marker crosses the web seam**: it is projected onto the web `TypeDefinition`/`Field` models. The original leak's root cause was exactly that `hiddenFromDefaultListing` never crossed that seam and so no web surface _could_ honor it.
- **`hiddenFromDefaultListing` stays a separate axis**: discoverability in the Entity Browser and user-assignability are different questions (a future template type could be user-addable yet hidden from listing). The asset type carries both.

## Considered Options

- **Per-surface visibility flags** (`addable: false` on types, `attachable: false` on fields, beside `hiddenFromDefaultListing`) — rejected: names the UI effect rather than the truth, leaves the removal/detach direction open (a picker filter doesn't stop stripping the type), and every future surface must remember which boolean applies.
- **UI-only enforcement** — rejected: any API caller or forgetful future surface can still orphan bytes; the fix is a few lines at the one write choke point this codebase already routes everything through.
- **Reopening ADR-0065 (bespoke assets table)** — rejected: the leaks are presentation-surface filters, not model cracks; identity, rights, dedup, and deletion all hold. The documented fallback stays dormant.
