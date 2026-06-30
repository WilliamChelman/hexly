---
status: accepted (forward decision — depends on ADR-0032; not yet implemented)
---

# The "hot entity" realtime contact layer

Adopting TrailBase (ADR-0032) brings SSE realtime: subscribe to an entity by id and receive the full new `document` on every save, last-write-wins (no merge). The open entity at `/entities/:id` becomes "hot" — it should reflect saves from another tab or an Editor live. The question is how that inbound push fits the existing **single-writer** contact layer: `EntitySession`'s debounced autosave + reference-equality `dirty` (ADR-0026), optimistic `version`/409 conflict (ADR-0005/0018), and the stateless `EntitiesClient`. We decided realtime is **additive** to that machinery, not a rewrite of it.

## Decisions

- **Scope: the open entity only.** List / Entity Browser / World Index surfaces stay fire-and-forget (refresh on navigation). Subscribing every visible row is many streams for near-zero value at our scale; add live lists the day someone asks for one.
- **SSE *augments* `version`/409, it does not replace it.** On an inbound push, `EntitySession` branches on its own `dirty()`:
  - **clean → `adopt()`** the pushed document (live-follow; re-baseline so it doesn't read as dirty).
  - **dirty → set `_conflict`** to the pushed document and let the *existing* conflict chip + manual Reload (ADR-0026, #6) resolve it — never clobber unsaved edits.
  The server-side `version` access-rule (ADR-0032) remains the write **authority**; the save still version-checks and 409s as a backstop. SSE is just a **faster, push-based heads-up** that the base moved, instead of finding out only when the next save bounces.
- **Facade: `EntitiesClient.watch(id)` beside `load(id)`.** `watch` merges the initial GET and the live SSE subscription into one `Observable<EntityDetail>` (initial snapshot + every push). `load` stays the **one-shot** for the conflict re-pull (`reload()` needs a single *completing* GET, #4) and for list / link-name reads. The client owns transport end to end; `EntitySession` never imports anything SSE.
- **`EntitiesClient` stays stateless.** "Stateless" = holds no open-entity/conflict fields; the SSE connection lives in the `watch` Observable's subscription and is torn down on unsubscribe (route leave), never stored. The adopt-vs-conflict **decision cannot move into the client** because it depends on `dirty()`, which is derived from the session's baseline vs the live editor signals. So: **client = transport, session = meaning.** The session is transport-ignorant (sees `EntityDetail`, not SSE) but remains the semantics owner.
- **No `SyncProvider` abstraction now.** `EntitySession` is already the containment boundary (ADR-0026: "replace the scheduler wholesale… cheap to discard"). A provider interface with one implementation would be designed against an imagined Yjs API and almost certainly wrong. The discipline that actually prevents a future rewrite is *negative*: **editor components and the URL never see `version`/409/HTTP** — they bind only to the session's signal surface (`content`/`grid`/`tags`/`dirty`/`conflict`/`saving`). When Yjs co-editing lands (a separate sidecar, ADR-0032), it replaces `EntitySession`'s internals with a real second implementation in hand to shape any interface against.
- **Always-on in v1, no user toggle.** Live-follow of the open entity is simply correct; an "off" state would mean "show me stale data." The "opt-in" was the *architectural* choice to adopt realtime (ADR-0032), not a user setting. A view-local pause can be added later if a real need appears; Yjs co-editing is the genuinely opt-in mode.

## Consequences

- Reuses the conflict machinery wholesale — the dirty-case inbound push routes through the same `_conflict` chip and Reload the 409 path already drives. Minimal new surface: open `watch` in the open path, branch on `dirty()` per emission, close on route leave.
- The clean-case `adopt()` already re-baselines, so live-follow can't leave a viewed entity falsely dirty.
- "Hot entity" is an architecture term, not domain language — it stays out of `CONTEXT.md` (glossary-only) and lives here.
- Reconnect/resume semantics (TrailBase's layered sequence numbers for detecting dropped events) are an implementation detail of `watch`, deferred until the subscription is built.
