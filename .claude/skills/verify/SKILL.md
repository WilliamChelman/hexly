---
name: verify
description: Build, launch and drive Hexly (NestJS API + Angular web) to observe a change at its real surface — HTTP, SSE, or the browser.
---

# Verifying a change in Hexly

The two surfaces are the **API socket** (HTTP + the `/api/events` SSE stream) and the
**browser** (Angular at `/`). Live-follow changes need both: the server emits, the client
decides whether to refetch.

## Launch

The API needs an Instance Directory (`HEXLY_DIR`) holding `hexly.db`. Migrations apply at
boot (ADR-0027), so a fresh empty directory is a working instance.

```bash
VDIR=$(mktemp -d)                       # never point this at the repo
npx nx build api                        # webpack; also typechecks
HEXLY_DIR=$VDIR node dist/apps/api/seed.js ada@hexly.test "correct horse battery" "Ada" --with-world
HEXLY_DIR=$VDIR node dist/apps/api/seed.js bob@hexly.test "hunter2 stationery" "Bob"
HEXLY_DIR=$VDIR PORT=3000 node dist/apps/api/main.js &   # health: GET /api/health
```

There is **no signup endpoint** (ADR-0004) — `seed.js` is the only way to make a user.
`--with-world` matters: an Entity cannot be created without a World (ADR-0024).

For the browser, `nx serve web --port 4299`. Its `proxy.conf.json` forwards `/api` to
**port 3000**, so the API must be on 3000 or the proxy needs editing. First bundle takes
~40s. Routes: `/login`, `/entities/:id` (redirects to the slugged `/w/:world/entities/:slug`),
`/w/:worldId`.

## Driving the API

Cookie auth: `POST /api/auth/login` → read `res.headers.getSetCookie()`, join the
`name=value` pairs, send as `cookie:`.

SSE live-follow is a three-step handshake, and skipping step 2 means you receive nothing:

1. `GET /api/events` (cookie, or `?token=` for a Public Link) → first frame is
   `event: ready` with `{ connectionId }`.
2. `PUT /api/events/:connectionId/interest` with `{ refs: [{ kind: 'entity'|'world', id }] }` → 204.
3. Mutate from *another* session; frames arrive as `event: nudge`, `data: [{ id, seq }]`
   or `[{ id, unavailable: true }]`.

Filter out `event: heartbeat` frames (every 30s) or they will be mistaken for nudges.

Gotcha that cost time: a hand-rolled frame reader must not both buffer a frame *and*
resolve a pending waiter with it, or `next()` returns the stale `ready` frame forever.

`PUT /api/entities/:id` (save) returns the `EntityDetail` **directly**, not the
`{ status, entity }` outcome wrapper the service returns internally.

## Driving the browser

Playwright MCP. Log out between users with
`await fetch('/api/auth/logout', { method: 'POST' })` via `browser_evaluate`, then reload
`/login` — otherwise the session survives navigation.

Screenshots land in the **repo root**, not the scratchpad. Move them out and `rm -rf
.playwright-mcp` before finishing.

## Flows worth driving

- **Live eviction** — Bob holds an entity-level grant on a `private` Entity and has it open;
  Ada `DELETE /api/entities/:id/grants/:userId`. Bob's editor must swap to the
  "No longer available" panel with no reload.
- **Self-echo dedupe** — type in the editor (autosave `PUT`), then check
  `browser_network_requests` for a `GET` of that entity afterwards. There must be **none**:
  the write-through store advanced its held `seq`, so the server's echo nudge is gated out.
  To prove the server really emitted, open a second SSE connection from node as the same
  user and watch the frame land there while the browser stays quiet.
- **Freshness vs. timestamps** — a grant change or a visibility flip must bump `seq` and
  leave `version` and `updatedAt` alone (ADR-0045). Sleep >1s between mutations, or a
  same-millisecond `updatedAt` hides a bump you meant to catch.

## Don't

`nx test` / `tsc` are CI, not verification. A passing unit suite proved nothing about
eviction the last time this area shipped a bug.
