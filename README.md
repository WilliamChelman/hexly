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

The container starts on port 3000. Data is persisted to a named Docker volume (`hexly-data`).

**Seed the first user** (required before anyone can log in — there is no public signup):

```sh
docker exec hexly-hexly-1 node dist/apps/api/seed.js <email> <password> "<display name>"
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

```sh
pnpm dev
```

Runs both apps together:

- **API** on `http://localhost:3000`
- **Web** on `http://localhost:4200`

The web dev server proxies `/auth` and `/health` to the API (see
`apps/web/proxy.conf.json`), so the browser talks to a single origin and the
session cookie rides along automatically.

Run them separately if you prefer:

```sh
pnpm dev:api    # NestJS API only
pnpm dev:web    # Angular app only
```

## Seeding a user (required to log in)

There is **no public signup** — Hexly serves a small, closed set of users who
are provisioned out-of-band (see
[ADR-0004](./docs/adr/0004-closed-user-set-role-based-sharing.md)). So before you
can log in locally you must seed at least one user:

```sh
pnpm seed <email> <password> "<display name>"

# example — creates a local dev login:
pnpm seed dev@hexly.test devpass "Dev User"
```

Then sign in at `http://localhost:4200/login` with those credentials. Passwords
are stored as argon2 hashes; the plaintext is never persisted.

### Where the data lives

The API stores everything in a single SQLite file (WAL mode). The dev scripts
pin it to `hexly.db` at the repo root via `HEXLY_DB_PATH`, so:

- `pnpm seed` and `pnpm dev`/`pnpm dev:api` always agree on the same file, and
- the database **survives rebuilds** (the API build cleans `dist/`, so the
  default in-bundle location would be wiped on every serve).

`hexly.db*` is git-ignored. To start fresh, delete it and re-seed:

```sh
rm -f hexly.db hexly.db-wal hexly.db-shm
pnpm seed dev@hexly.test devpass "Dev User"
```

Set `HEXLY_DB_PATH` to an absolute path to point at a different/shared database
(it's honored as-is when absolute; a relative value resolves against the current
working directory).

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
