# Decorative slug URLs with lossless base62 ids

## Context

Private routes keyed World and Entity segments by raw UUID —
`/w/c6b611f6-…/entities/274900e5-…` — which is unwelcoming and gives no sense
of _where you are_. We want orientation (read the URL, know the World and
Entity) without the machinery of true slugs.

## Decision

Every id-bearing private segment renders as `slugify(name) + '-' + base62(uuid)`
(e.g. `/w/avalon-5Qk9dLm2Xy/entities/the-whisperwood-3kTMd82jQm`). Two
properties make this cheap and safe:

- **The slug is decorative and never parsed.** The key is the substring after
  the final `-` (or the whole segment if there is none). Names stay non-unique
  and mutable, exactly as the model already assumes — no `slug` column, no
  uniqueness constraint, no migration.
- **The base62 suffix is the UUID, losslessly re-encoded.** It decodes
  byte-for-byte back to the canonical UUID before any read site, so the API,
  the reconcile/redirect guards, and inline Entity Links (which store a raw
  `entityId`, not a URL) are untouched. This is a client-only change.

Supporting rules:

- **Legacy URLs resolve forever.** The parse helper uses a full UUID verbatim
  and base62-decodes anything else — old bare-UUID links, bookmarks, and e2e
  specs keep working.
- **Self-heal at the route.** Two guards rewrite the address bar to canonical
  (redirect → `replaceUrl`, no history entry). The `w/:worldId` parent guard
  (`activeWorldGuard`) fetches the World detail, pins it into `ActiveWorld` (so
  name/owners/rights are loaded once for the whole scope, not re-fetched per
  page), and heals the **World** segment — covering every World-scoped page
  including cold direct loads. The child `reconcileWorldSegment` heals the
  **entity** segment (name from the fetched entity) and, on a wrong-World link,
  redirects with a bare World segment the parent then heals. A stale or wrong
  slug is only ever _cosmetically_ wrong — it never gates a 404; the suffix is
  the sole authority.
- **Slugify is total and dependency-free.** Lowercase, accent-fold via
  `normalize('NFD')` (covers EN/FR), non-`[a-z0-9]` → `-`, cap ~60 chars; an
  empty result (all-emoji/CJK name) omits the slug and yields a bare key.
- **Public/token routes are untouched.** Their segments are unguessable secrets,
  not ids, so there is nothing to prettify.

## Considered Options

- **True unique slugs (`/avalon/entities/whisperwood`, no UUID).** Rejected:
  requires a `slug` column, per-scope uniqueness, collision suffixing, a
  rename/redirect history table, and a backfill — real invariants that fight a
  model which deliberately never made names unique.
- **Truncated short codes (8-char id prefix).** Rejected: turns clean
  primary-key lookups into world-/instance-scoped prefix scans and adds an
  ambiguous-prefix failure mode — real backend surface for cosmetics on a
  suffix the slug already made irrelevant. Base62 halves the length for free.
- **Transliteration library for non-Latin names.** Rejected: heavy dependency
  for a case the two supported locales (EN/FR) never hit; the bare-key fallback
  degrades to exactly today's behaviour.
