# hexly

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (`WilliamChelman/hexly`) via the `gh` CLI. External PRs are **not** a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical label vocabulary — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Code comments

Comment the _why_ — design intent, the ADR a choice serves, a non-obvious constraint — never the _what_ the code already states. Keep it to a clause, not an essay: cite the ADR and move on. No editorial prose.
