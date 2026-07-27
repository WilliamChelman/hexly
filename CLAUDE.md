# hexly

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (`WilliamChelman/hexly`) via the `gh` CLI. External PRs are **not** a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical label vocabulary — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## End-to-end tests

The Playwright suite is self-contained — its `webServer` boots the app + API against a freshly-seeded throwaway DB. `dist/apps/api` (+ seed) and `dist/apps/web` must be built first; `nx e2e web-e2e` builds them for you.

It is serial by design (`workers: 1`) and boots seven servers, so a full run costs several minutes on top of the builds. Iterate narrow, confirm wide:

- While iterating, run one spec: `npx playwright test -c apps/web-e2e/playwright.config.ts <spec>`, with `E2E_REUSE_SERVER=1` to skip re-booting the servers (local only).
- Once, before calling the work done, run `nx e2e web-e2e` with `E2E_REUSE_SERVER` unset. That is the run you may report as green.

Same shape for unit tests: `nx test <project>` while you work, `nx run-many -t test` at the end. `nx test api` is marked flaky — re-run before believing a red.

## Code comments

Comment the _why_ — design intent, the ADR a choice serves, a non-obvious constraint — never the _what_ the code already states. Keep it to a clause, not an essay: cite the ADR and move on. No editorial prose.
