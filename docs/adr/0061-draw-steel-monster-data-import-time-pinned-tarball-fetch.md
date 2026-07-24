# Draw Steel monster data: import-time pinned-tarball fetch, not vendored

The Draw Steel _Monsters_ content is © MCDM Productions, usable by us under the **Draw Steel Creator License** — which grants reuse of the game's text, mechanics, and proper names — but explicitly **not** via the MetaMorphic Foundry module's own license (that product disclaims Creator-License coverage). So the right we lean on is MCDM's public license directly, not MetaMorphic's redistribution. Rather than vendoring the pack, the Draw Steel server **Importer** (ADR-0060) fetches it at import time from a **pinned commit-SHA** GitHub codeload tarball, transforms in memory, and discards — so neither the repo nor the deployed artifact carries the bulk content, and "wipe-and-reimport" re-pulls the pinned revision. Only a handful of tiny fixtures (Ajax, one Goblin) are committed, to drive the transform's unit tests. Creator-License compliance is baked into the transform, not left to a checklist: all art references (`img`) are dropped, the plugin ships the required non-affiliation NOTICE, and no MCDM/DRAW STEEL logos are used. Pinning a **SHA** (not the `1.1.x` branch) keeps imports reproducible and keeps the transform's committed fixtures aligned with what a live import produces.

## Considered Options

- **Vendor the raw pack (or a pre-transformed dataset) into the repo.** Legally permissible under the Creator License _with_ the notice and art stripped — so this was a hygiene choice, not a legal wall — but it keeps a large third-party dataset in the repo and lets it silently drift from upstream. Declined.
- **Runtime `git clone` on import.** Rejected: needs a `git` binary and a history-bearing clone for no gain over an HTTPS codeload tarball of the pinned ref.
- **Build-time fetch + `.gitignore`.** Rejected: still ships the content **inside the deployed artifact** and leaves fresh checkouts non-functional until the fetch runs. Import-time fetch keeps both the repo and the artifact clean.

## Consequences

- Import requires network egress to GitHub at the moment it runs; an air-gapped instance cannot import until a local-path override via the instance data directory (ADR-0036) is added — deferred until asked.
- Bumping to a newer pack is a **code change** (moving the pinned SHA). Reimport therefore re-applies the same revision unless the pin moves — its job is re-running transform improvements and resetting edits, not chasing upstream.
- The Creator License covers only its listed products (_Monsters_ among them); an importer for content outside that set would need its own licensing check.
