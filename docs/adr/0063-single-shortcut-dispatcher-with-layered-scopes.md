# Single shortcut dispatcher with layered scopes

Keyboard shortcuts used to be independent `window:keydown` listeners — the Hex Map canvas, the Board surface, the Command Palette — none aware of the others or of an open dialog. That shipped real bugs: Backspace behind a modal picker deleted the surface selection under it, Escape closed the dialog _and_ cleared the selection, and Alt+letter chords re-armed Tools because matching ignored modifiers. We decided on **one dispatcher**: a `ShortcutService` in `web-core` holding the app's only (lazily attached) window keydown listener, into which every surface registers its bindings on a named **layer** — `modal`, `editable`, `surface`, `global`.

Dispatch, per keydown:

1. While any **modal scope** is held (`pushModalScope()`, counted and re-entrant; `DialogService.open` holds one per dialog), only `modal`-layer registrations are considered. Unmatched keys are left alone, so the native `<dialog>` keeps its own typing and Escape-to-close.
2. Else, if the event target is editable (`INPUT`/`TEXTAREA`/contentEditable — the shared `isEditableTarget`), only `editable`-layer registrations plus those marked `inEditable` run (for chords like Cmd+K that must work mid-typing). This gate also applies inside a modal scope.
3. Else `surface`-layer registrations run before `global` ones, each layer in registration order. The first whose chord matches, whose `when()` passes, and whose handler doesn't return `false` (the fall-through signal) wins; `preventDefault()` fires only then.

Chords are strings (`'mod+shift+z'`, `'escape'`, `'v'`): `mod` resolves to ⌘ on mac and Ctrl elsewhere (platform behind an injectable token, so specs pin it), `event.key` matches case-insensitively, and **all four modifiers match exactly** — a registration for `'v'` never fires on Alt+V. Registrations made in an injection context unregister with the caller's `DestroyRef`.

## Considered Options

- **Per-surface window listeners (status quo)** — each surface re-implements editable-target suppression and cannot know a modal is up; the dialog bugs are structural, fixable only by every listener re-checking every other surface's state.
- **DOM/focus-scoped listeners** — bind keydown on each surface's element and rely on focus to scope. Rejected: canvas surfaces deliberately listen window-wide (shortcuts must work without the canvas focused), and a modal still needs to silence them all.
- **One dispatcher with explicit layers (chosen)** — the modal/editable gating exists once, by construction; a dialog claims the keyboard by holding a scope, not by every surface checking for dialogs. Costs a registration API and an ordering contract, both spec-covered.

## Consequences

- `DialogService.open()` holds a modal scope until its `DialogRef` closes, so `web-ui` now depends on `web-core` (in-layer for core←ui←app). Dialogs mounted declaratively (`<app-dialog [open]>`) originally did not hold a scope — the Command Palette relied on that to let Cmd/Ctrl+K toggle itself closed.
- **Amendment:** `DialogComponent` itself now holds the scope whenever its native `<dialog>` is open (pushed on `showModal`, popped on close/destroy), so declarative dialogs get the same keyboard claim as `DialogService` ones — without it, a surface's Escape registration preventDefaulted the keydown, cancelling the native "cancel" and leaving dialogs over a board/hexmap unclosable. The Command Palette keeps its toggle with a second, `modal`-layer Cmd/Ctrl+K registration gated on the palette being open. Nothing else in the dispatch semantics changes.
- Surfaces stop owning listeners: the Hex Map canvas and the Command Palette register bindings instead (the Board surface migrates next). New surfaces get modal- and typing-safety for free and cannot reintroduce the class of bug.
- Exact-modifier matching is the contract, not a per-surface courtesy: incidental legacy matches (Alt/Shift+letter arming a Tool, Ctrl+Shift+K opening the palette) are gone deliberately.
- Ordering within a layer is registration order, so a surface that wants precedence must register first or gate with `when()`/`return false` — acceptable while layers stay coarse; revisit with priorities if two surfaces ever contest one chord.
