# Closed user set, role-based sharing, public read-only link

There is **no public self-serve signup.** Users are provisioned out-of-band into a closed set (~5 people); login is email + password (hashed with argon2/bcrypt), sessions via an HttpOnly cookie. This is deliberate and will surprise anyone expecting a registration page — it matches a small "desktop-style" app and removes the entire credential-lifecycle and bot-abuse surface (email verification, password reset, captchas).

Sharing a Hex Map works two ways:

- **Named-user roles** within the closed set: **Owner** (full control + sharing), **Editor** (async, last-write-wins edits guarded by the map version), **Viewer** (read-only).
- A **public read-only link**: an unguessable, unlisted token granting account-less read access — the way a world is shown to players/outsiders.

## Considered Options

Self-serve signup and OAuth (Discord was the runner-up, given the TTRPG audience) were rejected for v1 as more machinery than a 5-person tool needs; either can be added later. Restricting sharing to logged-in users only (no public link) was considered to avoid the one unauthenticated code path, but the public link is the only way to reach people outside the closed set, so it was kept.

## Consequences

- The public-link fetch (`GET /public/:token`) is the sole unauthenticated endpoint and must be treated as such (read-only, token-scoped, rotatable/revocable).
- Multi-editor conflicts are resolved by the optimistic version check, not real-time merging.
