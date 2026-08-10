# Visibility gains `open`; the Public Link and anonymous read retire

**Entity Visibility** gains a third rung — `open`, readable by any signed-in caller on the Instance — and a World may be **Open** to that same audience over its `shared` Entities. In exchange, both **Public Links** (the per-Entity one and the **World Public Link**) retire, and with them the entire anonymous read path: `GET /public/**` and the `world_links` / `entity_links` tables go, and **no read is ever anonymous again**. This reverses ADR-0004's decision to keep the link — "the only way to reach people outside the closed set" — and rewrites the cemented reachability of ADR-0037.

The driver is that the link was the **sole unauthenticated endpoint**, and it carried disproportionate weight for it: an anonymous, account-less reader is the reason the World Theme is untrusted input (ADR-0076), the reason live-follow must accept a token principal (ADR-0044), the reason i18n cannot assume an account (ADR-0014/0038), and the reason ADR-0080 could not close its "mount a pack, mint a link, licensed content in front of the unauthenticated" redistribution hole. On a closed Instance whose members already hold accounts, the link served the vanishing case of the one reader who does not — at the cost of an anonymous surface threaded through a third of the ADR log. `open` gives outsiders the same reach the operator already grants a **Compendium** ("being on this Instance _is_ the standing", ADR-0078), asking only that the reader have an account.

## The invariant

`open` and **Open World** change **reachability**, never **listing**. Reachability gains the disjuncts _the Entity is `open`_ and _the Entity is `shared` in an Open World_, both resolving to "any signed-in caller". Listing is untouched: the Palette and every browse stay World-and-Mounts-scoped (ADR-0083), the World Index stays "the Worlds you have" (ADR-0080). So a non-member reaches an `open` Entity or an Open World **by its id or URL and finds it listed nowhere** — the exact unlisted property the retired links had, minus the anonymity and minus the unguessable token. Because a reader must be signed in, an id being enumerable is not a leak: enumeration reaches only what `open` already means to expose.

## Considered Options

- **Keep the link (status quo, ADR-0004).** Rejected: it keeps the one unauthenticated surface and everything downstream that must defend against it, to serve a reader who, on a closed Instance, is rare.
- **`open` means anonymous.** Rejected: it does not kill the unauth path, it worsens it — a state on a guessable id, with no token to rotate and no grant to revoke.
- **Keep unguessable tokens for `open` Entities.** Rejected: that is the Public Link rebuilt under a new name; the point was to delete the anonymous surface, not rename it.
- **Name the value `public` or `everyone`.** Rejected: `public` reads, on a security control, as "the open internet" — the precise exposure this removes — and re-uses `Entity Visibility`'s banned word; `everyone` names the audience, not the Entity's state. `open` states the condition and implies no internet reach. (See CONTEXT.md.)

## Consequences

- **ADR-0037 is amended.** The `world_links` and `entity_links` tables drop; the anonymous grant disjuncts leave the reachability resolver, replaced by the `open` / Open-World disjuncts. Named grants (Owner, Editor, Viewer, Contributor, member roles) and the Superadmin override are unchanged.
- **The per-Entity link's pierce-`private` capability moves to named Viewer grants.** "Let this specific outsider read this one otherwise-private Entity" is now a **Viewer** grant on that account — never a link, and never anonymous. There is no successor for the anonymous pierce, by design.
- **Anonymity leaves the rest of the model.** Live-follow's principal is cookie-only (ADR-0044); the anonymous-viewer justifications for `localStorage`-as-source retire (ADR-0014/0038); the `/public/**` route gate in the Deployment Profile has nothing left to gate (ADR-0071); the Compendium page and the Mount cascade need only reach signed-in callers, which they already do, closing ADR-0080's redistribution hole outright.
- **The World Theme stays untrusted input (ADR-0076), with its framing updated.** A non-member reading an Open World is signed in but is still a stranger to the author, so the values still execute in a browser with no trust relationship to whoever authored them. The "anonymous, no account" wording narrows to "a signed-in non-member".
- **Facets.** The `$visibility` Facet and token gain the `open` value; nothing else about Facets changes.
