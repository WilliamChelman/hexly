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

## Installing the Desktop App

Every [release](https://github.com/WilliamChelman/hexly/releases/latest) carries one installer per platform
beside that container image — the same Hexly, running on your own machine over its own **Instance Directory** in
your user profile, with no account and no login (ADR-0070):

| Platform              | File                                    |
| --------------------- | --------------------------------------- |
| macOS (Apple Silicon) | `Hexly-<version>-macos-arm64.dmg`       |
| Windows               | `Hexly-<version>-windows-x64.exe`       |
| Linux                 | `Hexly-<version>-linux-x86_64.AppImage` |

Each is a ~150 MB download: it carries its own Electron and its own Node modules, so there is nothing else to
install.

**The builds are unsigned, and therefore have no auto-update** — the macOS updater refuses to update an unsigned
bundle, so the two are one decision (ADR-0070). Updating means downloading a later installer and opening it; the
Instance Directory stays where it is.

Being unsigned also means every platform warns you the first time you open one. **That warning is expected — the
download is not broken** — and each platform has its own way through:

- **macOS.** Open the `.dmg` and drag **Hexly** into Applications. The first open is refused, saying the
  developer cannot be verified. Open **System Settings → Privacy & Security**, scroll to the message naming
  Hexly, click **Open Anyway**, then confirm at the prompt. Recent macOS (15 and later) has removed the old
  Finder right-click → **Open** bypass, so this is the route. It opens normally from then on.
- **Windows.** SmartScreen shows "Windows protected your PC" and hides the run button behind **More info** —
  click that, then **Run anyway**. The installer needs no administrator rights; it installs for you alone.
- **Linux.** The AppImage needs the executable bit before a double-click does anything:
  `chmod +x Hexly-*.AppImage`. There is nothing to install and no root involved.

That Instance Directory sits in the platform's application-support folder — `~/Library/Application Support/Hexly/hexly`
on macOS, `%APPDATA%\Hexly\hexly` on Windows, `~/.config/Hexly/hexly` on Linux — and is the folder to copy to back
your Worlds up. The **File** menu's reveal item opens it for you (named for your platform's file manager).
Asset bytes can be moved off it from the same menu (**Move Asset Storage…**); the database stays put
deliberately — ADR-0070 explains why a synced folder is the one place it must not be.

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

### Finding a dev process

The dev scripts name every process nx forks, so they are greppable instead of a
row of identical `node` entries:

```sh
$ pgrep -fl hexly:
hexly:web:serve         # the Angular dev server
hexly:api:serve         # nx supervising the API
hexly:api:serve:app     # the API server itself — the one listening on :3000
```

`pkill -f hexly:` clears a stuck run. Naming happens in
`scripts/name-nx-processes.mjs`, preloaded via `NODE_OPTIONS`; the long-lived nx
daemon is deliberately left out of it. Note that `pnpm dev` leaves the previous
`:app` process behind on each API rebuild — an nx `run-many` quirk, not a
symptom of the naming.

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

### Watching main's event loop

Main's loop serves every HTTP response as well as the windows, so a slow handler is felt as a frozen menu
bar. The shell watches itself for it (ADR-0070, #329): any stretch past **100 ms** is logged with what main
had in hand, ranked so the likeliest culprit reads first, and anything too short to have caused the block is
counted rather than named.

```
[hexly] event-loop lag 1514ms peak in 2157ms — POST /api/worlds/import 1499ms, +45 too short to have held it
```

```sh
HEXLY_LOOP_LAG=off pnpm dev:desktop   # silence it
HEXLY_LOOP_LAG=25 pnpm dev:desktop    # report above 25ms instead, for a measuring run
```

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
unsigned bundle, so the two are one decision (ADR-0070). See
[Installing the Desktop App](#installing-the-desktop-app) for what a user meets on each platform, and say it
there rather than only here.

### Cutting a release

`workflow_dispatch` on `ci.yml` (main or beta) is the whole release: semantic-release cuts the tag and a
**draft** GitHub Release, the container image goes to `ghcr.io`, then the `desktop` matrix packages the app on a
macOS, a Windows and a Linux runner and attaches one installer each — `HEXLY_VERSION` is what names them, since
semantic-release writes no version back into `package.json`. The `publish-release` job is the only thing that
undrafts, and it runs only if all three legs did: a platform whose build failed leaves an unpublished draft and
a red run rather than a release quietly short a download (#328). Each leg runs the same post-package smoke check
`pnpm package:desktop` does locally, so the platform that cannot thumbnail fails there instead of on a user's
machine. Nothing signs anything; the macOS installer is Apple Silicon only, being what `macos-latest` is.

Three warnings show up on every green build and mean nothing is wrong — **default Electron icon is used** (no icon
asset exists yet), **platform-specific optional dependencies not bundled** listing every _other_ platform's
`sharp`/libvips/`@node-rs` binaries (which is per-platform packaging working, and the reason for the matrix), and
a suggestion to remove `@electron/rebuild` as an excess dependency (it is not: `npmRebuild: false` means that
package is the one doing our forced rebuild).

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
  maxCreatedEntities: 5000 # ceiling on the Entities one import mints for unresolved
  #     wikilinks (ADR-0073); past it they land as Unresolved Links and the
  #     summary counts them dangling, rather than the import failing.
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
entities:
  defaultType: core.type.note # the Entity Type the "New" button mints (ADR-0052)
  inlineType: core.type.note # the Entity Type Inline Creation mints (ADR-0073)
  inlineTag: untriaged # a Tag put on everything created inline (ADR-0073);
  #     omit the key — the default — and nothing is tagged.
theme: # your deployment's own branding (ADR-0076); omit the key — the default —
  #     and Hexly renders exactly as it always has. See below.
  version: 2
  light: solar # a ready-made Palette Preset, by name...
  dark:
    accent: '#7ad3a4' # ...or your own anchors. See below for both.
```

#### Branding your deployment (`theme`)

`theme` is an **Instance default Theme**: the first link of the chain **Instance
default → World Theme → the reader's ColorScheme** (ADR-0076). It ships empty,
and it is a **starting point, not an imposition** — a World that has authored its
own Theme is unaffected by it, field by field, so your radii survive under a World
that only re-anchors its colours.

A **ColorScheme** is `light` or `dark` — the day/night axis a reader toggles
between, and the two keys the block carries colours under. You supply both; which
one a reader sees stays their choice, not yours.

Every field but one is optional. `version: 2` is required whenever the block is
present: it is the contract these values were authored against, and a version this
build does not know fails boot rather than being applied in part. Each of `light:`
and `dark:` then accepts exactly three forms.

##### Form 1 — name a Palette Preset

Hexly ships six ready-made **Palettes**, three per ColorScheme, so branding a
deployment is one word rather than eleven hex values (ADR-0077):

| ColorScheme | Preset id   | What it is                                                             |
| ----------- | ----------- | ---------------------------------------------------------------------- |
| `light`     | `solar`     | Hexly's own day: warm ivory paper, sepia ink, heliograph gold.         |
| `light`     | `vellum`    | Cool neutral paper, slate ink — the personality taken out.             |
| `light`     | `herbarium` | Pale sage paper, deep forest ink, brass.                               |
| `dark`      | `astral`    | Hexly's own night: midnight indigo, parchment ink, constellation gold. |
| `dark`      | `obsidian`  | Neutral near-black, cool ink, cyan.                                    |
| `dark`      | `ember`     | Warm charcoal, ash ink, forge-orange.                                  |

```yaml
theme:
  version: 2
  light: solar
  dark: astral
```

A bare id is shorthand for a `preset:` key — `light:` on one line and
`preset: solar` indented under it says the same thing, and is what Form 3 builds on.

##### Form 2 — write your own anchors

Any subset of the eleven tier-1 values (ADR-0075) — eight colours and three
numbers. Everything you leave out falls through to the stylesheet:

```yaml
theme:
  version: 2
  light:
    page: '#f4ece0' # the outer paper
    ink: '#20242e' # primary text ink
    inkQuiet: '#5c6472' # secondary ink; carries its own hue
    accent: '#2f6f4f' # the through-line accent — the roles above it derive from it
    danger: '#a4402e'
    success: '#4a6f2f'
    canvas: '#efe7db' # the map field
    soot: '#2a2f38' # shadow / scrim ink
    polarity: 1 # ±1, every ramp's direction: 1 for a light Palette, -1 for a dark one
    lineAlpha: 0.371 # opacity of the drawn-rule ramp
    veil: 0.12 # base opacity of shadows, scrims and the vignette
  dark:
    accent: '#7ad3a4' # branding your accent alone is two anchors, one per ColorScheme
```

##### Form 3 — a Preset, then your own anchors over it

Resolved field by field: the Preset seeds all eleven values and yours win over it,
so you can take a ready-made Palette with your own accent.

```yaml
theme:
  version: 2
  light:
    preset: solar
    accent: '#2f6f4f' # wins over Solar's; the other ten stay Solar's
  dark:
    preset: astral
  radii: # the cheapest identity lever there is: sharp versus soft
    --radius-md: 0px
  fontPairing: codex # one of the curated pairings
  overrides: # per-ColorScheme opt-outs from a derived role, keyed by token
    light:
      --color-ink: '#101010'
```

Worth knowing before you write one:

- **Quote your colours.** A bare `#2f6f4f` is a YAML comment. Any CSS colour
  notation is accepted (`#rgb`, `rgb()`, `oklch()`, a named colour); it is parsed
  and stored back as canonical `oklch(…)`, which is what the browser is then sent.
- **A malformed value fails boot**, naming every offending key
  (`theme.light.accent: not a color value`). So does a key **misspelled inside**
  the block — branding applied in part is worse than a refusal you can see. Alone
  in `hexly.yml`, this block does not quietly strip what it does not recognise;
  a misspelled `theme:` itself still does, as any top-level key does (ADR-0052).
- **A Preset id belongs to its own ColorScheme.** `light: astral` is eleven values
  authored for the other end of the day, so it is refused at `theme.light.preset`
  with the ids that would have worked — as is an id that names no Preset at all.
- **The id lives in this file and nowhere else.** It is resolved to values at boot,
  so nothing downstream ever learns one was named, and no World's stored Theme ever
  holds a Preset's name (ADR-0077). That is what makes an unknown id a startup
  failure you can read rather than a silent one years later.
- **A Preset's own fixed tokens come with it.** Each dark Preset states its own
  `--color-canvas-glow`, and naming one folds that into `overrides.dark` for you —
  under anything you write there yourself, which still wins.
- **Silence falls through.** Whatever the block does not mention keeps Hexly's own
  value, so a partial theme is a partial theme and not a half-painted one.
- **The `--radius-*` family is the whole of `radii`**, and `overrides` keys only
  tokens in the public contract. The type scale, the layout rails and motion are
  structure and reader accessibility rather than identity, and are deliberately
  not themeable (ADR-0076).
- **It is served unauthenticated**, on `GET /api/config`, because a World Public
  Link visitor has no session and must still be themed.

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

`entities.defaultType` and `entities.inlineType` sit next to each other and are
**not** the same knob, because they answer different questions (ADR-0073).
`defaultType` is _"the user asked for an Entity — which kind?"_ — your opinion
about your campaign, and rightly `core.type.hex-map` on a map-first instance.
`inlineType` faces _"nobody has said what this is yet"_, which is the question
**Inline Creation** asks when an Entity is minted from a name rather than from a
create surface. Share one value between them and a map-first instance mints a
Hex Map from a name typed mid-sentence.

`entities.inlineTag` is the triage lever for that pile: everything created
inline carries it, so the untriaged names are one click away in the Tag facet.
Unset by default and the string is yours to choose, so nothing is imposed on
authors who do not want the bookkeeping.

Neither Type id is checked at boot — an unregistered or disabled Type degrades
at the point of use rather than failing the instance, exactly as `defaultType`
already behaves.

Both knobs are also what a **vault import** mints under: every `[[wikilink]]`
naming no note becomes a real Entity rather than an **Unresolved Link**, so the
vault's to-write list survives the trip (ADR-0073). An import may override the
switch, the Type, and the Tag **for that run only** — nothing an import sends is
written back to `hexly.yml`. An untyped `.md` file still lands on
`entities.defaultType`: it is a note the vault held, not a name it only
mentioned.

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
