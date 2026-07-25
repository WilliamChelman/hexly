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

## Amendment: **Missing Bytes** is a state on the Asset, checked per read (#325)

Naming that indicator is what makes the knob safe to offer, so it ships with it. An Asset whose bytes are absent from the resolved root carries `assetBytesMissing` on its read model, and its surfaces — the Asset's View (so a Board **Embed** of it too) and the **Asset Browser** tile — render a distinct state ahead of the mime dispatch, never the icon-card fallback (which also means "not an image") and never a broken-image glyph. Its Stats and prose still render: nothing about them was lost, which is precisely the distinction the state exists to draw.

- **Per read, one stat, no new table.** The derived dedup index (ADR-0065) gains an `ext` column so it holds the whole byte address, not just the dedup key — the hash alone names no file, and without the extension a presence check would have to list the World's folder. With it, a read is one `existsSync` at a known path. Nullable, not defaulted: a row written before the column existed has an _unknown_ address, and the next save or Reindex fills it. This replaces `harvestAssetHash` with `harvestAssetRef` on the **Structured Data Type** contract.
- **Computed on read, never stored.** No derived "missing" column exists to go stale — restoring the file clears the state on the next read, with no Reindex. That is also why the state may cost a stat per read: it is gated on the reads that draw Asset imagery (the thumbnail opt-in and the single-Entity detail), so no other list pays for it.
- **Fail-present.** An unregistered probe or an incomplete address reports _nothing_ missing. A false "your file is gone" is strictly worse than a missed indicator: the whole value of the state is that a user can trust it to mean "elsewhere, not lost".
- **The original alone answers the question.** The thumbnail is deliberately not consulted — it is a regenerable cache that may never have existed (a PDF, bytes sharp could not parse) and the serving route falls back to the original anyway.
- **`entities` still does not know what an Asset is.** The probe is registered on an `AssetBytesRegistry` in the `entities` module by `AssetsService` — the one holder of the resolved root — exactly as it registers its deletion reaper (ADR-0065). The dependency stays one-way.
- **Own bytes only.** A broken **Thumbnail** _designation_ (ADR-0066) is the designated Asset's story, not the designating Entity's, so the flag never rides a designation. Surfaces that draw a designated Asset therefore still resolve its URL and drop the image on load failure; the naming happens on the Asset itself.
- **Surfaces that show an Asset's bytes without being the Asset** — the Board **Image** element (already a named placeholder with retry), the Board image picker and the asset-link picker (both over `AssetSummary`, which carries no flag) — are unchanged for now. They render thumbnails, and a picker that must not offer stranded art is its own decision; the state lives where the user goes to understand it.
