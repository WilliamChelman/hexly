# E2E tests: Playwright over the real single-origin build, as a seam regression net

E2E is a **small, curated regression net** over the cross-process *seams* — cookie auth, the HTTP round trip, and persistence across reload — not a per-feature acceptance suite (domain logic stays covered by the vitest specs). The runner is **Playwright** (chromium only) in a new `apps/web-e2e` project, run via `nx e2e web-e2e`.

Tests run against the **real production build**: the api serves the built SPA on a **single origin** (ADR-0008), so Playwright's `webServer` boots one Nest process (`dist/apps/api/main.js` serving `dist/apps/web/browser`) and tests hit one port. There is no separate proxy and no two-origin/CORS setup — the harness *is* the prod topology.

## Considered Options / key choices

- **Both built production; runtime `NODE_ENV` left non-production.** Web and api are both built `production` for real fidelity. The one thing that must differ from prod is the cookie `secure` flag: it is gated on `NODE_ENV==='production'`, and a `secure` cookie is never set over plain `http://localhost`, which would silently break every login. The api bundle reads `process.env.NODE_ENV` at **runtime** (verified — webpack does not inline it for the node target), so the `webServer` simply launches the prod build with `NODE_ENV` unset/`test` and `secure` stays off. The alternative (run over HTTPS with a self-signed cert under real `NODE_ENV=production`) was rejected: it invents a TLS story the app doesn't otherwise have, to exercise a single boolean that TLS-at-the-edge owns in real deployment.

- **Assert through model-derived DOM + persistence-by-reload, supplemented by an API read.** The map is Canvas 2D pixels (ADR-0003), so there is no DOM to query for hexes. Tests drive the real UI and assert on DOM that genuinely reflects state (the status bar's hex count, with a11y-first locators), prove the round trip by **reloading and re-asserting**, and use a direct `GET /api/maps/:id` for data the DOM can't show. Rejected: canvas pixel/screenshot diffing (flaky across OS/CI, tests rendering not seams) and a `window` test hook (pollutes prod with a test seam).

- **Isolation via a guarded, maps-only reset route.** A test-only `POST /api/test/reset` truncates **maps only** (keeping `users` and `sessions`, so a once-logged-in `storageState` session survives and no re-login churn is needed). It is **conditionally registered** — present only when `HEXLY_E2E==='1'` *and* `NODE_ENV!=='production'` — so in production the route is physically absent (404), not merely guarded. Rejected: per-test DB/server restart (too slow) and unique-data-per-test with a shared DB (the user wanted a real clean slate). Because reset is global mutable state, the suite runs `workers: 1` (serial).

## Consequences

- The dedicated **login/logout journey uses its own fresh session**, not the shared `storageState` — `logout` deletes its session row server-side, and sharing the token would invalidate every other test's reused cookie.
- The e2e DB is a throwaway file (`HEXLY_DB_PATH` → `tmp/`), seeded with one fixed user at server start; it never touches the real `hexly.db`.
- The suite can only assert what the app makes **observable**; today that is the hex count, auth, and navigation. It grows as the inspector/coords get wired (currently static mockups).
- Initial journeys: (1) auth & guard, (2) paint → save → reload persistence + API data check, (3) map-library CRUD. Deferred to unit specs: pan/zoom, undo/redo, pixel correctness. Stretch: the version-conflict path.
- CI runs e2e as a dedicated job (install chromium → `nx e2e web-e2e` → upload the HTML report on failure), separate from `lint/test/build`.
