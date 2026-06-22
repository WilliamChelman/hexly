# Runtime i18n with Transloco and client-owned copy

The app ships English-only today, with user-facing strings hardcoded across ~48 inline component templates and a few catalog labels in the shared domain lib. We are adding internationalization to ship **French** (and stay translation-ready), using **[Transloco](https://jsverse.gitbook.io/transloco)** for **runtime** language switching, with **all user-facing copy owned by the web client** and the locale chosen entirely client-side.

## What we decided

- **Runtime switching, not build-time locales.** One JS bundle ships every language; a user-visible switcher flips the UI live with no reload. This rules out Angular's native `@angular/localize` (which compiles a separate bundle per locale, served from `/en/`, `/fr/`) — that model can't offer an in-app switcher and can't gracefully serve an anonymous **public-link viewer** whose locale is unknown at build time.

- **Transloco over ngx-translate.** Both are runtime JSON i18n libraries; Transloco wins on first-class lazy **scopes**, a maintained **signal API** (`translateSignal` / `translateObjectSignal`) that fits this **zoneless Angular 21** app, and better tooling (`@jsverse/transloco-keys-manager` for key scaffolding). We lean on the signal API where reactivity matters rather than the legacy pipe/structural directive.

- **One global file per language.** `assets/i18n/en.json` and `fr.json`, a single key tree — not per-feature scoped files. At two languages and this string count, the only payoff of scopes (shaving KB off the initial transfer) is negligible against the per-folder `provideTranslocoScope` tax. A scope for `editor-shell` can be carved out later non-breakingly if its strings balloon.

- **Semantic namespaced keys, namespaced by feature.** `editorShell.toolPalette.select`, `mapLibrary.*`, `auth.*`, plus a shared `common.*` bucket for reused atoms (Save / Cancel / Close). The English text lives as the value in `en.json`, so the file stays readable. Natural keys (key = source string) were rejected: they rot when copy changes, collide across contexts, and get ugly with punctuation.

- **English is the source and the fallback.** `en.json` is the **source of truth** for the key set: every key originates in English, and `fr.json` must mirror it exactly — no key may exist in `fr.json` without an `en.json` counterpart, and vice versa. Default on first visit is detected from `navigator.language` (French when it starts with `fr`, else English). A missing French key **falls back to the English value** at runtime so the UI never shows a raw key — while CI fails on key drift, so gaps still get fixed. Graceful in prod, strict in CI.

- **Locale is client-only; account persistence is deferred.** The switcher writes to `localStorage`; Transloco reads it on bootstrap. This covers every actor — logged-in users on their device *and* anonymous public-link viewers — with **zero backend change**. Persisting a per-user `locale` (a `users` column, an `AuthUser` field, a write endpoint) is a clean later enhancement, not part of this work.

- **The server is not localized.** The API already speaks in **HTTP status codes + structured data** (`BadRequestException()`, `ConflictException(version)`), never user-facing prose, and the client already turns outcomes into copy (e.g. a 401 on login → a client string). i18n stays entirely in the web app: the client maps status/result shape → translation key. No `Accept-Language` handling; the internal `throw new Error(...)` 500 logs stay English (developer-facing).

- **What is *not* translated.** User-typed **content** — Region names, Labels, Notes, map titles — is data and is never translated. Built-in **catalog labels** (terrain/feature `label`s in the framework-agnostic domain lib) *are* translated, but at the **UI layer keyed by their stable `id`** (`domain.terrain.grass`, `domain.feature.settlement`); the domain `label` stays as the English default/fallback and the domain lib never imports Transloco. Canonical glossary nouns (Region, Hex, Terrain…) are translated to natural French; the product name **"Hexly" stays**. `CONTEXT.md` stays the single source of truth for the domain vocabulary, and each noun's French rendering lives directly in `fr.json`.

- **The one locale-sensitive format** (`map-library`'s `new Date(updatedAt).toLocaleDateString()`) is driven by the active Transloco lang rather than the browser default. No `DatePipe`/`registerLocaleData` is introduced; `@jsverse/transloco-locale` is the escalation if locale formatting ever grows.

## Considered options

- **`@angular/localize` (build-time).** Rejected: no runtime switcher, and per-locale bundles can't serve an anonymous public-link viewer whose language is unknown at build.
- **ngx-translate.** Viable, but weaker scopes/signal story and tooling than Transloco on a zoneless Angular 21 app.
- **Account-persisted locale from day one.** Deferred: requires a DB migration + contract change for a cross-device nicety that localStorage already approximates on the common path.
- **Localizing the API (`Accept-Language` + message tables).** Rejected: the boundary is already clean (status codes in, client copy out); localizing the server would split the copy pipeline across two apps for no gain.

## Consequences

- **Tests keep asserting English.** A shared `provideTranslocoTesting()` loads the real `en.json` into TestBeds, so existing `textContent.toContain('Sign in')`-style assertions survive unchanged and double as a check that referenced keys exist. A dedicated Playwright test flips the switcher to French and asserts French strings, covering the switch path without translating the whole e2e suite.
- **CI gains a key-sync gate** that fails when `en.json` and `fr.json` drift — a key present in one catalog but not the other (missing *or* orphaned). It is a small, unit-tested `findKeyDrift(en, fr)` comparator run by the `web:i18n-sync` Nx target, diffing the two catalogs' flattened key sets with **`en.json` as the authoritative reference**. `@jsverse/transloco-keys-manager` was evaluated but its current major validates keys only by *scanning source*, not by comparing the two language files against each other, so it cannot enforce en↔fr parity — and it would mis-flag staged keys not yet referenced in code; the custom diff matches the requirement directly. No brittle "no hardcoded string" lint rule — the key-set diff plus review is the guard.
- **No `CONTEXT.md` change.** The English ubiquitous language is unchanged; i18n adds a second rendering, not a new model.
