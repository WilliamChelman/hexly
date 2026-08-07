# Testing

Iterate narrow, confirm wide. Only the wide run may be reported as green.

| Case                                   | Command                                              |
| -------------------------------------- | ---------------------------------------------------- |
| One e2e spec                           | `nx e2e web-e2e --testFiles=<spec>`                  |
| One e2e test                           | `nx e2e web-e2e --testFiles=<spec> --grep "<title>"` |
| All e2e, if needed                     | `nx e2e web-e2e`                                     |
| One project's unit tests               | `nx test <project>`                                  |
| One unit spec file                     | `nx test <project> --include="**/<name>.spec.ts"`    |
| Unit tests by name                     | `nx test <project> --filter "<test-name regex>"`     |
| All unit tests, before calling it done | `nx run-many -t test`                                |

- The unit target is `@angular/build:unit-test`, not vitest passthrough: positional file args, `--run` and `--testPathPattern` are rejected, and `--filter` matches test _names_, never paths — use `--include=<glob>` for files. Bare `vitest` breaks on workspace path aliases.
- `--testFiles` selects the Playwright project and its auth setup from the file, so a `config/` spec needs no `--project`.
- `E2E_REUSE_SERVER=1` skips re-booting the seven servers (local only). Unset it for the wide run.
- `nx test api` is marked flaky — re-run before believing a red.
