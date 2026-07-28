# Testing

Iterate narrow, confirm wide. Only the wide run may be reported as green.

| Case                                   | Command                                              |
| -------------------------------------- | ---------------------------------------------------- |
| One e2e spec                           | `nx e2e web-e2e --testFiles=<spec>`                  |
| One e2e test                           | `nx e2e web-e2e --testFiles=<spec> --grep "<title>"` |
| All e2e, if needed                     | `nx e2e web-e2e`                                     |
| One project's unit tests               | `nx test <project>`                                  |
| All unit tests, before calling it done | `nx run-many -t test`                                |

- `--testFiles` selects the Playwright project and its auth setup from the file, so a `config/` spec needs no `--project`.
- `E2E_REUSE_SERVER=1` skips re-booting the seven servers (local only). Unset it for the wide run.
- `nx test api` is marked flaky — re-run before believing a red.
