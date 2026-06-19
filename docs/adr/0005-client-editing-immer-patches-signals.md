# Client editing: Immer patches + Angular signals, REST + shared Zod

The Angular editor holds the current Hex Map as **immutable state in a signal**. Every mutation runs through Immer's `produceWithPatches`, which returns the new state plus forward and inverse JSON patches; the editor service updates the signal and pushes the inverse patch onto an undo stack. Undo applies the inverse patch, redo applies the forward patch.

We chose patch-based undo/redo over a hand-written command pattern (every operation must author its own inverse — tedious and bug-prone as operations multiply) and over whole-document snapshots (memory-heavy on a large sparse map). Patches give automatic, correct inverses with minimal memory, and are a natural substrate if async multi-editor merging is ever added.

State lives in **plain Angular signals — no NgRx**; the command/undo stack is the only "store" the editor needs. The one discipline this imposes: *all* mutations must go through the Immer producer; nothing mutates the document directly.

The client talks to the NestJS backend over **REST**. The **Zod schema in `libs/domain`** is the single source of truth — it validates requests on the server and types the client's calls — giving most of tRPC's end-to-end safety without fighting either framework. The optimistic-concurrency version conflict surfaces as an HTTP 409 the client handles by re-pulling.
