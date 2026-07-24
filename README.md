# Hexly

A web application for creating and editing **hex maps** for TTRPG games and
worldbuilding. Maps are persisted to user accounts and can be shared. See
[`CONTEXT.md`](./CONTEXT.md) for the domain language and
[`docs/adr/`](./docs/adr) for the architectural decisions behind it.

It's an Nx monorepo:

| Path          | What it is                                                            |
| ------------- | --------------------------------------------------------------------- |
| `apps/web`    | Angular front end (standalone components + signals)                   |
| `apps/api`    | NestJS API (SQLite via Drizzle, served by Express)                    |
| `libs/domain` | Framework-free contracts shared by both runtimes (Zod schemas, types) |

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

You point the API at an **Instance Directory** via `HEXLY_DIR`; inside it live
the SQLite database `hexly.db` (WAL mode) and the optional config file
`hexly.yml` (see below). The dev scripts pin it to `hexly-data/` at the repo
root, so:

- `pnpm seed` and `pnpm dev`/`pnpm dev:api` always agree on the same folder, and
- the database **survives rebuilds** (the API build cleans `dist/`, so the
  default in-bundle location would be wiped on every serve).

`hexly-data/` is git-ignored. To start fresh, delete the db and re-seed:

```sh
rm -f hexly-data/hexly.db hexly-data/hexly.db-wal hexly-data/hexly.db-shm
pnpm seed dev@hexly.test devpass "Dev User"
```

Set `HEXLY_DIR` to an absolute path to point at a different/shared folder
(honored as-is when absolute; a relative value resolves against the current
working directory).

### Instance configuration (`hexly.yml`)

Drop an optional `hexly.yml` in the Instance Directory to tune per-instance
settings (ADR-0036). It's the single source for these — there are no env-var
overrides. A missing or partial file falls back to built-in defaults; an invalid
file fails boot with the offending key named. Sizes are human-readable
(`500mb`, `1.5gb`).

```yaml
# hexly-data/hexly.yml — all keys optional; shown with their defaults
import:
  maxUpload: 500mb # ceiling on an uploaded vault .zip (images ride inside it)
  maxDecompressed: 5gb # ceiling on the inflated vault (markdown + assets); zip-bomb backstop
  strictZipGuard:
    false # false: fast import, guard on the zip's *declared* size.
    # true: slower, streams and meters *actual* output to abort a
    #       bomb mid-inflate — set on an untrusted/public instance.
search:
  weights: # bm25 relevance multipliers per indexed column (ADR-0035)
    name: 10 # a query word in the name outranks the same word...
    tags: 5 # ...in a tag...
    content: 1 # ...in the body. Retune if e.g. very long notes skew results.
features:
  collaboration: true # the sharing layer entire — World members, entity grants,
  #                     Entity Visibility, Public Links (ADR-0071). Turn it off if
  #                     you self-host for yourself alone; your login page stays
  #                     either way, since that's auth, not collaboration.
  plugin: # per-Plugin enablement (ADR-0052); every bundled Plugin is on by default
    dnd:
      enabled: false # a disabled Plugin's Types degrade to the generic View, values intact
```

`collaboration` is read but not yet acted on: the sharing surfaces and the 404s
behind them land as ADR-0071 is built out, so setting it today changes nothing
you can see.

There is deliberately **no `profile` key**: whether an instance is `desktop` or
`server` is pinned by the entry point it was started from, so a `profile:` line
written into `hexly.yml` is ignored (ADR-0071).

Turning `collaboration` back **on** later has a consequence worth knowing before
you do it: every Entity authored while it was off is `private` (the schema
default), so it stays invisible to anyone you then invite. Nothing is lost —
flipping the Visibility of what you want to share fixes it — but it is a
deliberate step, not automatic (ADR-0071).

`strictZipGuard` is a speed-vs-safety trade (ADR-0036). The default (`false`) batch-decompresses — several times faster on a large vault — and trusts the archive's declared sizes, which is right for a trusted personal/LAN instance importing your own vault. A maliciously crafted `.zip` can under-declare its size to slip past that check, so an **untrusted or public** instance should set `strictZipGuard: true`, which streams the archive and meters actual decompressed bytes to abort a zip bomb before it materializes. Either way `maxDecompressed` is enforced.

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

## Third-party notices

UI glyphs are from [Lucide](https://lucide.dev), used via `@lucide/angular`.
Lucide is ISC-licensed; the icons it derives from [Feather](https://feathericons.com)
are MIT-licensed.

> ISC License — Copyright (c) Lucide Contributors
> MIT License — Copyright (c) 2013-present Cole Bemis (Feather)

Full texts: [lucide.dev/license](https://lucide.dev/license) and the bundled
`node_modules/@lucide/angular/LICENSE`.
