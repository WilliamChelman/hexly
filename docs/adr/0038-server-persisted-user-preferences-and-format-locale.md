# Server-persisted user Preferences and a Format Locale distinct from UI language

ADR-0014 shipped locale/theme as **client-only** prefs in `localStorage`, explicitly deferring two things: **account persistence** (a per-user `locale`, an `AuthUser` field, a write endpoint — "a clean later enhancement") and richer **locale formatting** (`@jsverse/transloco-locale` as "the escalation if locale formatting ever grows"). This ADR cashes in both. We add a **User Settings** page where a signed-in user edits their **Preferences** — which now **roam with the account** — and a new **Format Locale** axis that decouples date/number/time formatting from the UI language.

## What we decided

- **Preferences roam; the server is authoritative for signed-in users.** A user's UI Locale, Format Locale, and theme persist on the user account and follow it across devices. `localStorage` is demoted from source-of-truth to (1) a boot cache (apply immediately, no unstyled/wrong-locale flash) and (2) the store for **anonymous public-link viewers**, who have no account and keep working exactly as under ADR-0014. On `/auth/me` resolving, server prefs hydrate and overwrite the local cache.

- **One JSON column, not discrete columns.** Preferences are stored as a single zod-validated `preferences` JSON bag on the `users` row. They are always read as a whole bag for one user and never DB-queried, so discrete columns would buy queryability we never use at the cost of a migration per new pref. New prefs are henceforth a code-only change to the zod schema in `libs/domain`.

- **Prefs ride on the existing auth payload.** `preferences` is folded into the `/auth/me` and login responses — no second boot round-trip, and `AuthClient` becomes the single carrier. Writes go to a dedicated `PATCH /auth/me/preferences`. View prefs apply instantly and persist on change (matching today's live menu feel); the user menu keeps its inline theme + language controls and the page duplicates them — both write the same `LocaleService`/`ThemeService` signals, so there is one source of truth in code and two entry points, not two states.

- **Format Locale is a first-class axis, distinct from UI Locale.** ADR-0014's single date format was driven by the active Transloco *language*. It is now driven by a separate **Format Locale** (a BCP-47 tag, default = UI Locale when unset), fed to native `Intl`. This fixes the motivating complaint — an English *reader* who wants non-US date/number formatting — in one knob that also covers numbers and times, with no custom formatter. The picker shows curated human labels (e.g. "United Kingdom — 04/07/2026", "ISO — 2026-07-04") mapping to tags under the hood. Formatting is exposed as a standalone `| hexlyDate` Angular pipe reading the Format Locale signal, replacing the inline `toLocaleDateString(lang)` call in the entity browser.

- **Self-service profile: display name and password only.** The page lets a user edit their `displayName` (simple validated `PATCH`) and change their password (current password re-verified against the hash, new password min-length, re-hash). **Email stays read-only** — it is the unique login identity and there is no signup/verification flow (ADR-0004), so self-editing it to an unverified address is an account-integrity risk; email changes remain an Instance Admin concern. Invalidating other sessions on password change is deferred.

## Considered options

- **localStorage stays source-of-truth, server just mirrors.** Rejected: two devices diverge with no clear winner, so "roaming" would be a lie.
- **Last-write-wins by per-pref timestamp.** Rejected as premature: real symmetric multi-device conflict resolution for a handful of view prefs is more machinery than the payoff warrants; server-authoritative is enough.
- **Partial bag + seed-the-server-from-localStorage on first login.** This would preserve a user's existing localStorage-only choices (the server can't see `localStorage`). Rejected in favour of the simpler full-backfill below — see the consequence.

## Consequences

- **The deploy migration resets divergent localStorage-only choices.** Every user's `preferences` bag is backfilled to app defaults at migration time. Because the server cannot read `localStorage`, a user who manually chose a language/theme that *differs from their computed default* (e.g. English browser, manually set French) reverts to the default on their first post-deploy login. Blast radius is small — a closed, seeded user set with `en`/`fr` only — and was accepted for the simpler read path over the seed-from-local alternative.
- **`AuthUser` / `/auth/me` contract grows a `preferences` field**, and the `users` table gains one column (hand-synced across `schema.ts` and the `db.ts` DDL, plus a drizzle-kit migration, per ADR-0027).
- **ADR-0014 is amended, not superseded.** Its client-only *rendering* of i18n stands; only its "account persistence deferred" and "one language-driven date format" clauses are now realised here.
