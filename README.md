# Hexly

A web application for creating and editing **hex maps** for TTRPG games and
worldbuilding. Maps are persisted to user accounts and can be shared. See
[`CONTEXT.md`](./CONTEXT.md) for the domain language and
[`docs/adr/`](./docs/adr) for the architectural decisions behind it.

It's an Nx monorepo:

| Path           | What it is                                                            |
| -------------- | --------------------------------------------------------------------- |
| `apps/web`     | Angular front end (standalone components + signals)                   |
| `apps/api`     | NestJS API (SQLite via Drizzle, served by Express)                    |
| `apps/desktop` | Electron shell hosting that same API in-process (the Desktop App)     |
| `libs/domain`  | Framework-free contracts shared by both runtimes (Zod schemas, types) |

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

## The Desktop App

`apps/desktop` is an Electron shell whose **main process boots the same Nest `AppModule`** on an
ephemeral loopback port and points a window at it (ADR-0070), so one process serves the API, the SPA
and the Asset URLs exactly as the container does. It pins the `desktop` Deployment Profile and
Collaboration **off** (ADR-0071 — a `features.collaboration: true` in that Instance's `hexly.yml` is
ignored), keeps its Instance Directory in the platform's application-support folder, and seeds and
authenticates a **Sole User** at first launch. There is no login screen and no password.

```sh
pnpm native:electron   # once: rebuild better-sqlite3 against Electron's ABI (see below)
pnpm dev:desktop       # builds the SPA + the shell, then opens the window
```

`NODE_ENV` is deliberately never `production` in the shell: the session cookie's `secure` flag keys on
it, and a `secure` cookie is never stored over plain `http://127.0.0.1`, so the Sole User's session
would silently fail to stick. The production _build_ ships without the literal env value.

### Native modules and the ABI switch

`better-sqlite3` is a classic C++ addon, so its binary must match the ABI of the runtime that opens the
database — **Electron's, not Node's** — and one `node_modules` holds one build. So the two flavours are
a switch, not a coexistence:

```sh
pnpm native:electron   # for pnpm dev:desktop
pnpm native:node       # back to plain Node: pnpm dev, nx test api, nx e2e web-e2e
```

Run `pnpm native:node` before the API tests or the browser e2e suite, or they fail to load the addon.
`sharp` and `@node-rs/argon2` are Node-API modules and ride along unchanged. On macOS the rebuild also
ad-hoc re-signs the addon (`scripts/sign-native-addons.mjs`) — the code-signing monitor kills Electron
outright when it `dlopen`s the linker-signed prebuild.

### Packaging an installable app

```sh
pnpm package:desktop   # → dist/desktop/
```

One command, four steps: rebuild `better-sqlite3` for Electron's ABI, build the shell and the SPA, run
electron-builder (`apps/desktop/electron-builder.config.js`), then **open the package and use it** —
`apps/desktop-e2e/src/packaged/packaged-app.spec.ts` creates a World, thumbnails an image and hashes a
password inside the artifact, so a package whose native modules did not come along fails the build that
made it. Re-run just that part with:

```sh
pnpm exec playwright test -c apps/desktop-e2e/playwright.packaged.config.ts
```

Two things to expect. It builds for **this** machine's platform and architecture only — `sharp`'s
prebuilts and libvips are per-platform optional dependencies, so an install here holds binaries for here;
release builds one artifact per runner. And it leaves `node_modules` on Electron's ABI, so run
`pnpm native:node` afterwards.

Builds are **unsigned, and therefore have no auto-update** — the macOS updater refuses to update an
unsigned bundle, so the two are one decision (ADR-0070). Every platform will warn about the download; on
recent macOS the route is System Settings → Privacy & Security → **Open Anyway**, the Finder right-click
bypass having been removed.

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
assets:
  dir: /Volumes/big-disk/hexly-assets # where Asset bytes are stored (ADR-0034);
  #     absolute, or relative to the Instance Directory. Omit the key — the default —
  #     and they stay in the `assets` folder beside hexly.db.
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

With `collaboration: false` the sharing and user-management endpoints — entity
grants, owner sets, World members, both kinds of Public Link, and `/api/users` —
answer **404**: absent, not merely hidden, so a stale browser tab or a script
cannot mint a link into an instance you believe is private (ADR-0071). Your
login page and the Superadmin Reindex are never gated by it. The buttons that
reach those endpoints disappear from the UI as ADR-0071 is built out.

There is deliberately **no `profile` key**: whether an instance is `desktop` or
`server` is pinned by the entry point it was started from, so a `profile:` line
written into `hexly.yml` is ignored (ADR-0071).

Turning `collaboration` back **on** later has a consequence worth knowing before
you do it: every Entity authored while it was off is `private` (the schema
default), so it stays invisible to anyone you then invite. Nothing is lost —
flipping the Visibility of what you want to share fixes it — but it is a
deliberate step, not automatic (ADR-0071).

`assets.dir` moves **Asset bytes only** — the database stays in the Instance
Directory, on purpose: assets are the bulk of the data and safe to park on an
external drive, a NAS, or a mounted volume, whereas the same volume under
`hexly.db` risks a corrupt vault (ADR-0034, ADR-0070). The worst an unmounted or
stale assets volume costs you is **missing bytes**.

Changing `assets.dir` **does not move the bytes you already have**: it is read
once at boot and simply becomes the new root, so Assets stored under the old one
read as missing until you move them. Moving them is your own operation — stop the
instance, copy `<old-root>/<worldId>/…` into the new root, restart.

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
