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
