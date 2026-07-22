# hexly

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (`WilliamChelman/hexly`) via the `gh` CLI. External PRs are **not** a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical label vocabulary — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## End-to-end tests

The Playwright suite is cheap and self-contained — its `webServer` boots the app + API against a freshly-seeded throwaway DB, so no manual stack is needed. Run it as part of "done": `nx e2e web-e2e` (or a subset via `npx playwright test -c apps/web-e2e/playwright.config.ts <spec>`). `dist/apps/api` (+ seed) and `dist/apps/web` must be built first; `nx e2e web-e2e` builds them for you.

## Code comments

Comment the _why_ — design intent, the ADR a choice serves, a non-obvious constraint — never the _what_ the code already states. Keep it to a clause, not an essay: cite the ADR and move on. No editorial prose.
