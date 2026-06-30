# Hexly

A web application for creating and editing **hex maps** for TTRPG games and
worldbuilding. Maps are persisted to user accounts and can be shared. See
[`CONTEXT.md`](./CONTEXT.md) for the domain language and
[`docs/adr/`](./docs/adr) for the architectural decisions behind it.

It's an Nx monorepo:

| Path           | What it is                                                              |
| -------------- | ---------------------------------------------------------------------- |
| `apps/web`     | Angular front end (standalone components + signals)                     |
| `apps/api`     | NestJS API (SQLite via Drizzle, served by Express)                      |
| `libs/domain`  | Framework-free contracts shared by both runtimes (Zod schemas, types)   |

## Self-hosting

Requires Docker and Docker Compose.

```sh
curl -O https://raw.githubusercontent.com/WilliamChelman/hexly/main/docker-compose.yml
docker compose up -d
```

The container runs a single TrailBase process serving the built SPA and the API on
one origin (ADR-0008, ADR-0032). It starts on port 3000; the TrailBase depot (DB,
config, uploads) is persisted to `./hexly-data`. The admin UI is at
`http://localhost:3000/_/admin/`.

**Seed the first user** (required before anyone can log in — there is no public
signup). Under the closed-set config both steps are needed: `user add` registers
the account, `change-password` stores the usable credential.

```sh
docker exec hexly-hexly-1 trail --data-dir /data user add <email> <password>
docker exec hexly-hexly-1 trail --data-dir /data user change-password <email> <password>
```

**Upgrade** to the latest release:

```sh
docker compose pull && docker compose up -d
```

---

## Prerequisites

- **Node.js** 20.x–24.x (developed on 24)
- **pnpm** 10.33+ (the repo pins it via `packageManager`)

```sh
pnpm install
```

## Local development

The backbone is [TrailBase](https://trailbase.io) (ADR-0032) — a single binary
that owns auth and (soon) the data APIs. The first run downloads the pinned
release into `.trailbase/` (git-ignored); no manual install.

```sh
pnpm dev
```

Runs both together:

- **TrailBase** (API + admin) on `http://localhost:4000`
- **Web** on `http://localhost:4200`

The web dev server proxies `/api` to TrailBase (see `apps/web/proxy.conf.json`),
so the browser talks to a single origin. The **admin UI** is at
`http://localhost:4000/_/admin/` — its credentials are printed to the terminal
the first time TrailBase boots.

Run them separately if you prefer:

```sh
pnpm dev:api    # TrailBase only
pnpm dev:web    # Angular app only
```

## Seeding a user (required to log in)

There is **no public signup** — Hexly serves a small, closed set of users
(ADR-0004) provisioned by an admin; TrailBase's config disables the `/register`
endpoint. So before you can log in locally you must provision at least one user:

```sh
pnpm seed <email> <password>

# example — creates a local dev login:
pnpm seed dev@hexly.test devpass
```

Then sign in at `http://localhost:4200/login` with those credentials. (You can
also manage users from the admin UI.) TrailBase stores password hashes; the
plaintext is never persisted.

### Where the data lives

TrailBase keeps everything under `./traildepot`: `config.textproto` is committed,
while runtime state (`data/` SQLite DBs, `secrets/`, `uploads/`, …) is
git-ignored. To start fresh, delete the runtime state and re-seed:

```sh
rm -rf traildepot/data traildepot/secrets
pnpm seed dev@hexly.test devpass
```

## Build, test, lint

```sh
pnpm build          # build api + web
pnpm test           # run all unit/integration tests (Vitest)
pnpm lint           # lint all projects
```

Under the hood these are Nx targets, so you can also scope to one project:

```sh
nx test api
nx serve web
nx run-many -t test -p api,web,domain
```

## How auth works (quick map)

- **Login** (`POST /auth/login`) verifies the password and sets an HttpOnly,
  same-site session cookie carrying an opaque token; the session row is the
  server-side source of truth (immediate revocation on logout).
- **`GET /auth/me`** resolves the cookie to the current user (guarded by
  `SessionAuthGuard` — the pattern future protected endpoints reuse).
- **Logout** (`POST /auth/logout`) deletes the session row.
- On the web, `AuthStore` mirrors the session into a signal; `authGuard` protects
  the editor route and redirects to `/login`, and `loginGuard` bounces
  already-authenticated users away from `/login`.

Full rationale: [ADR-0004](./docs/adr/0004-closed-user-set-role-based-sharing.md)
(closed user set) and [ADR-0002](./docs/adr/0002-sqlite-json-document-storage.md)
(SQLite storage).
