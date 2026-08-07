# Angular gotchas

- **No backticks in inline templates**, comments included: `template:` is a JS template literal, so a `` ` `` inside an HTML comment terminates it — the error (`TS1005`/`NG2012`) points somewhere unrelated.
- In specs, don't destroy TestBed's injector in `afterEach` — Vitest runs hooks LIFO, TestBed's own reset already did it, and the NG0205 throw poisons the next `configureTestingModule`.
- After setting a host/input signal in a spec, call `detectChanges()` before asserting — the component reads stale input otherwise.
- Spread `NodeList`s with `Array.from`, not `[...]` (no `downlevelIteration`).
