# A bundled Plugin is three Nx projects — core / server / web — so the API image sheds the frontend

ADR-0050, ADR-0051 and ADR-0053 gave each bundled **Plugin** a clean split _in code_: a framework-free
`lib/` kernel, a `/server` entry point the API bundles, and a `/web` (Angular/TipTap) entry point the SPA
bundles. The barrels are "framework-free by construction" — the API imports `@hexly/plugin-X` and
`@hexly/plugin-X/server` and never touches Angular.

But that seam lived only at the file/entry-point level. Each plugin was a **single Nx project**
(`libs/plugin-X`) holding all three halves. Nx attributes external dependencies at **project** granularity:
webpack's `generatePackageJson` (and `@nx/js:prune-lockfile`) walk the project graph, and `api → plugin-X`
pulled in _every_ dependency the plugin's `/web` half declared. So `dist/apps/api/package.json` listed
Angular, `@lucide/angular`, TipTap, transloco — 36 deps — even though `main.js` requires 18. The Docker
`prod-deps` stage then installed the entire frontend into the runtime image (~192 MB of `node_modules`,
~40 MB Angular + ~13 MB lucide + TipTap alone), none of which the API runs.

The code boundary was right; the **project boundary** was the thing the pruner sees, and it was wrong.

## Decision

**Each bundled Plugin is three Nx projects, one per adapter, matching the shared-kernel shape the code
already had (`web/ → lib/ ← server/`):**

- **`plugin-X` (core)** — the framework-free `lib/` kernel, exported at `@hexly/plugin-X`. Both other
  projects depend on it. Configured like `@hexly/domain`: `commonjs`, Node-only, vitest under a `node`
  environment, no Angular test target, `tags: []`.
- **`plugin-X-server`** — the `/server` adapter (`serverPluginX()`), at `@hexly/plugin-X/server`. Depends on
  core + `@hexly/domain`, nothing framework-bound.
- **`plugin-X-web`** — the `/web` adapter plus the plugin's `i18n/` and `testing/` halves, at
  `@hexly/plugin-X/web`, `/testing`, (`/i18n`). Depends on core + the web libs; the Angular/TipTap/lucide/
  transloco weight is confined here, and it keeps the Angular unit-test target. (The design-token lint
  was a `-web` property too until it moved to the root config, where it governs all 32 projects.)

Consumer import paths are unchanged — the `tsconfig.base.json` aliases now point at the new project dirs.
The API's project graph reaches only `plugin-X` and `plugin-X-server`; it can no longer reach a project that
depends on Angular.

**The content plugin's Markdown converters and vault data-type move into `plugin-content-server`.** They are
the only server-exclusive weight in the former `lib/` (the `unified`/`remark`/`yaml` toolchain), used solely
by the vault variant and its round-trip specs. Relocating them makes ADR-0053's "the converter toolchain
loads through `/server`" physically true, keeps the _core_ kernel genuinely shared (web's graph no longer
even contains the toolchain), and needs no `/vault` seam — the one ADR-0053 removed stays removed.

**The Docker `prod-deps` stage installs from the pruned manifest.** `api:build` (webpack
`generatePackageJson`) emits `dist/apps/api/{package.json,pnpm-lock.yaml}` listing only the API's runtime
deps; the runtime image installs those with `--frozen-lockfile` instead of the root `package.json`.

## Considered Options

- **2-way split (`core+server` / `web`)** — enough to shed the frontend, less churn. Rejected: the user
  chose the kernel/adapter shape, and folding `server` into `core` would make the _web_ project's graph
  depend on the server adapter's Node concerns. The 3-way mirrors `web/ → lib/ ← server/` exactly.
- **Keep one project per plugin, post-process `dist/apps/api/package.json`** in the Dockerfile to strip the
  frontend keys. Rejected: it hard-codes knowledge of which deps are web-only and rots silently; it papers
  over the project-boundary problem the split actually fixes.
- **A `@hexly/plugin-content/vault` alias** to let the split-out server reach the vault data-type in core.
  Rejected: re-introduces the exact public seam ADR-0053 deleted. Moving the code to `server` is the honest
  fix.
- **Switch the base image to `node:24-alpine`, or bundle all pure-JS deps into `main.js`.** Orthogonal, and
  both carry native-module (musl / ESM-interop) risk. Left for later; this change is risk-free and gets most
  of the win.

## Consequences

- **`dist/apps/api/package.json`: 36 → 18 dependencies**, exactly what `main.js` requires; zero Angular/
  TipTap/lucide/transloco. Runtime `node_modules`: **~192 MB → ~70 MB**. Docker image: **582 MB → 436 MB**.
- **Nine new project directories** (`plugin-{content,dnd,hexmap}-{server,web}`), each with its own
  `project.json`, tsconfigs, and `eslint.config.mjs`. Core/server projects carry the plain base lint; web
  projects keep the Angular flat config + design-token rules. Server projects with no specs yet set
  `passWithNoTests`.
- **Core plugin projects have no `build` target.** Like the originals they are compiled by their consumers
  (the API via webpack, the SPA via Angular), which is also where they are typechecked; an `@nx/js:tsc`
  build would fail on cross-project source-path `rootDir`.
- **Also fixed in the Dockerfile:** the runner stage now copies `dist/apps/api/migrations` (ADR-0027) — it
  was never copied, so the image threw `Can't find meta/_journal.json` at boot regardless of this change.
- **CONTEXT.md:** no vocabulary change — a **Plugin** still has its `providePluginX` / `serverPluginX`
  entry points; this only aligns the Nx project topology with the seams they already named.
