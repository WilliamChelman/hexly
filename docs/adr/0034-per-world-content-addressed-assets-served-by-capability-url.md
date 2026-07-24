# Assets: local per-World content-addressed files served by an unauthenticated capability URL

Vault import brings binary **Assets** (images, PDFs) — a subsystem Hexly had none of. We store Asset **bytes** on the local filesystem beside the SQLite DB (ADR-0002) at `assets/<worldId>/<sha256>.<ext>`, and Asset **metadata** (hash, worldId, original filename, mime, size, timestamp) in a new `assets` table (Drizzle, ADR-0027). Content-addressing by the bytes' sha256 buys free dedup and an unguessable path in one move. Content references an Asset by a `/assets/<worldId>/<hash>.<ext>` URL, rendered through the `image` node (ADR-0019, `tiptap-v3`).

## Decisions & consequences

- **Served with no auth**, via a static `GET /assets/...` route (single-origin, ADR-0008). The hash **is** the access token: possession of the link is the only control. **An Asset referenced from a `private` Entity is therefore readable by anyone who has the URL** — and capability URLs leak in practice (referrer headers, server logs, pasted links). Accepted deliberately for a ~5-user tool; to be revisited if real per-user asset privacy is ever needed.
- **No size limit** (accepted; TTRPG vaults are image-heavy and this is a personal tool).
- **Per-World folder** → deleting a World deletes its asset folder in one step; dedup is per-World (the same image in two Worlds is stored twice).
- **Original filename lives in the `assets` table**, not the on-disk name (which is the hash), so export can write human-readable filenames back into the vault, and a future asset-management UI has a table to hang off (out of scope here).
- **External image URLs** (`![](https://…)`) pass through as the `image` `src` unchanged; only vault-relative paths are imported into `assets/`.

## Considered Options

- **Authenticated serving, S3, or DB blobs** — rejected as over-built for the scale; local files + capability URLs are the lazy path that ships.
- **Defer binary storage, preserve only the reference as text** — considered as the v1 default, rejected: a map-heavy TTRPG vault renders too partially without its images, so Assets had to be in scope now.

## Amendment: `assets.dir` overrides the root (ADR-0070)

"Beside the SQLite DB" is now the _default_, not the rule. `hexly.yml` gains `assets.dir` — absolute, or relative to the Instance Directory, defaulting to `assets` — read through the existing `resolveAssetsDir` seam, with the `ASSETS_DIR` provider injecting `HEXLY_CONFIG` the way `MulterModule.registerAsync` does, so no consumer and no decorator reads config (ADR-0036).

The split is safety, not convenience. ADR-0002 runs SQLite in WAL mode, and a cloud-sync daemon or network mount rewriting `hexly.db`/`-wal` under an open handle corrupts the vault — which is why ADR-0070 pins the **Desktop App**'s Instance Directory to `userData` with no picker. Asset bytes carry no such hazard: content-addressed and write-once, an unsynced or unmounted file degrades to missing bytes, never to a corrupt database. They are also the bulk of the data, so they are the part worth moving to an external drive, a NAS, or a big mounted volume — which serves the Docker operator (fast local disk for the DB) as much as the desktop user.

Changing the knob **does not move existing bytes**: the new root is simply a new root, and an 8 GB cross-volume copy at boot with no progress, no cancel, and a partial-failure state where neither root is complete is worse than a deliberate move. The Desktop App therefore owns the move itself — a native picker that copies with progress, verifies by sha256, rewrites `hexly.yml`, and calls `app.relaunch()`, since config is read once at boot. Bytes stranded by a hand-edited `hexly.yml` surface as a missing-bytes indicator on the Asset rather than only in a log a desktop user never opens; presence is cheap to check, because every hash is already in the `assets` table.
