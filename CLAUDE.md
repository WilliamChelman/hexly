# hexly

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (`WilliamChelman/hexly`) via the `gh` CLI. External PRs are **not** a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical label vocabulary — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context: `CONTEXT-MAP.md` at the repo root indexes a root Platform `CONTEXT.md` plus a per-plugin `CONTEXT.md` in each plugin lib; ADRs in `docs/adr/`. See `docs/agents/domain.md`.

## Testing

See `docs/agents/testing.md`.

## Angular

Known traps (inline-template backticks, TestBed teardown): `docs/agents/angular.md`.

## Code comments

Comment the _why_ — design intent, the ADR a choice serves, a non-obvious constraint — never the _what_ the code already states. Keep it to a clause, not an essay: cite the ADR and move on. No editorial prose.
