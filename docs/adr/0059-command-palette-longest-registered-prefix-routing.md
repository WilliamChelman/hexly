# Command Palette: route by the longest registered Command Prefix

ADR-0032 routes Command Palette queries to Providers by a typed prefix, but the parser (`parseCommandQuery`) hard-coded the set to `>` and empty string — a single leading character each. Adding a Roll command under `/r ` (a multi-character prefix, itself beginning with `/`) needed either another hand-maintained branch in that function or a real generalisation. We generalised: the `CommandRegistry` now exposes its registered prefixes, and a query routes to the **longest** registered prefix it starts with (empty string being the always-present fallback). So `>note` still routes to Show Commands, `/r 2d10 + 3` routes to the dice Provider, and a Provider declaring a new prefix later needs no edit to the parser — the exact coupling ADR-0032 wanted Providers to avoid, now removed from the last place it lived.

## Considered Options

- **Hard-code `/r` beside `>` in `parseCommandQuery`.** Rejected: keeps a hand-maintained prefix list every future prefix must edit, contradicting ADR-0032's premise that Providers own their prefixes.
- **Reuse the `>` (Show Commands) prefix for rolling** (e.g. `>roll 2d10`). Rejected: `/r 2d10 + 3` is the terse, muscle-memory syntax users expect from chat/VTT tools, and folding it under `>` would force the Show-Commands Provider to know about dice.

## Consequences

- Prefixes are matched longest-first, so a shorter prefix can never shadow a longer one (a future `/rr ` would win over `/r ` for `/rr …`). Prefix authors must keep this ordering rule in mind, but it is enforced centrally, not per Provider.
- A query that happens to start with a registered prefix routes there rather than to Quick Open — e.g. an Entity literally named "/r …" is unreachable by typing its name raw. This mirrors the pre-existing behaviour of `>` and is accepted.
