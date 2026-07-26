# A `required` Field prompts, it does not gate: absence is **Incomplete**, only a present value is invalid

`validateFields` treats an absent value for a `required` Field as an error, and `assertTypedFieldsValid` turns that into a `400`. We are demoting it: **absence never refuses a write.** A `required` Field is a prompt to the author and a flag on a surface, and an Entity missing one is **Incomplete** (CONTEXT.md) — a state you can read, not a save you can't make. A _present_ value that does not match its Data Type stays a hard rejection, as does an Entity-Link Field whose resolvable target misses its target-type constraint. The rule is **shape violations are errors; absence is a hint.**

The name `required` stays. It is persisted on every user-defined Field row and declared across the bundled plugins, so renaming it to something honest (`expected`) would cost a migration and a sweep to buy a word — and the word is only misleading to a reader who has not met this ADR, which is what this ADR is for. The glossary carries the correction instead.

## What forced it

Three call sites already bend around the gate, each independently:

- `create-entity-dialog.component.ts:159` collects every required Field into the dialog and disables **Create** until they validate.
- `entity-types-editor.component.ts:218` prompts for a newly-added Type's required Fields.
- `new-entity-button.component.ts:124` — _if the default Type has required Fields, open the dialog instead of minting directly._

That last one is the tell. It is a workaround invented to avoid a rejection the system inflicts on itself, and designing **Inline Creation** (ADR-0073) reproduced it exactly: minting an Entity from a mention under an operator-configured Type meant either filtering the configurable Types to the mintable ones, or falling back to a modal mid-sentence. Two designs, arriving at the same bend, is the gate being wrong rather than the callers.

The gate was also never coherent. `validateFields`' own contract already says the caller decides when to enforce it — _"active typed edits only, never on import or data at rest, so already stored EntityDocument is never retroactively invalidated."_ So a required Field was already optional along one axis (how the value arrived) while absolute along another (which surface you used), and an author could hold a document the API would refuse to accept from them by hand. Demoting absence removes the axis rather than adding a third exemption to it.

## Considered Options

- **Rename `required` to `expected`** — rejected on cost, not on merit. It is the honest name, and the moment before user-defined Fields multiply is the cheapest it will ever be; but the flag is persisted (a drizzle-kit migration, ADR-0027) and declared across plugin types, and the glossary buys the same clarity for nothing. Reconsider if the misreading actually shows up in plugin code.
- **Keep the hard gate, exempt the paths that hurt** — rejected. That is the status quo plus a third exemption, and it is what produced `new-entity-button`'s special case. Every future creation path would have to remember which surfaces enforce and which don't.
- **Enforce on save but not on create** — rejected as the worst of both: it makes an Entity creatable and then unsavable, so the enforcement lands on an author mid-edit, furthest from where the Fields were chosen.

## Consequences

- **Nothing read a required Field's value assuming presence**, so the demotion breaks no reader — the flag was consumed only by gates. The change is `validateFields` no longer emitting `code: 'required'` as an error, and the three call sites above relaxing from _block_ to _flag_.
- **`FieldError.code` keeps `'required'`, but as an advisory reading.** Surfaces still need to know _which_ Fields are unfilled to flag them; only the caller's response changes. Keeping the code out of the error array while exposing it separately is the shape to aim for, so no caller can accidentally re-gate by treating a non-empty array as fatal.
- **ADR-0073's two workarounds die with it**: Inline Creation always mints silently under its configured Type, with no create-dialog fallback, and the import's Type control needs no mintable-only filter. Any Type can mint.
- **Incompleteness becomes a state worth surfacing, and nothing surfaces it yet.** The gate was crude, but it did get data filled in; removing it without a replacement means an Entity can drift incomplete forever with no reading that says so. The Details panel flagging unfilled `required` Fields is the minimum; a facet over incompleteness is the interesting version, and would recover most of the triage worklist ADR-0073 gave up when it rejected `core.type.stub`. Deliberately not built here — but this ADR is why it is now cheap.
- **A World's user-defined Types get looser in a way their authors did not choose.** Someone who ticked "required" on a World Field did so under the old contract and will find saves going through that used to be refused. There is no migration for an expectation; the checkbox's label and help text carry the new meaning.
