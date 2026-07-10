import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { assetUrl } from '@hexly/domain';
import { and, eq } from 'drizzle-orm';
import { DB, Db } from '../db/db';
import { assets } from '../db/schema';

/** DI token for the on-disk Assets root (`<instanceDir>/assets`, or a temp dir for `:memory:`). */
export const ASSETS_DIR = Symbol('ASSETS_DIR');

/**
 * Content type by lower-cased file extension, for the handful of Asset kinds a vault
 * carries (ADR-0034: images, PDFs). Kept deliberately small — a full mime library is
 * YAGNI for a personal tool; anything unlisted serves as a generic download.
 */
const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
};

/** The set of extensions Hexly treats as importable Assets (ADR-0034) — shared with the vault importer. */
export const ASSET_EXTENSIONS = new Set(Object.keys(MIME_BY_EXT));

/** What {@link AssetsService.store} tells the importer: the capability URL, the hash, and whether it deduped. */
export interface StoredAsset {
  readonly url: string;
  readonly hash: string;
  readonly deduped: boolean;
}

/**
 * Per-World content-addressed Asset storage (ADR-0034). Bytes are written to disk under
 * `<ASSETS_DIR>/<worldId>/<sha256>.<ext>`; metadata rows the `assets` table. Content-addressing
 * buys free dedup (same bytes → same hash → one file) and an unguessable path in one move — the
 * hash IS the capability token the unauthenticated serving route relies on.
 */
@Injectable()
export class AssetsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ASSETS_DIR) private readonly dir: string,
  ) {}

  /**
   * Store `bytes` for `worldId`, deduped by their sha256. A repeat (same bytes already stored
   * in this World) writes nothing and reports `deduped: true`, returning the existing capability
   * URL. `filename` supplies the extension (on disk and in the URL) and is kept for export.
   */
  store(worldId: string, filename: string, bytes: Uint8Array): StoredAsset {
    const hash = createHash('sha256').update(bytes).digest('hex');
    const existing = this.db
      .select({ originalFilename: assets.originalFilename })
      .from(assets)
      .where(and(eq(assets.worldId, worldId), eq(assets.hash, hash)))
      .get();
    if (existing) {
      // Match the on-disk name, which was minted from the FIRST store's extension (lower-cased,
      // like the write path below — else the served URL 404s on a case-sensitive filesystem).
      return { url: assetUrl(worldId, hash, extname(existing.originalFilename).toLowerCase()), hash, deduped: true };
    }

    const ext = extname(filename).toLowerCase();
    const worldDir = join(this.dir, worldId);
    mkdirSync(worldDir, { recursive: true });
    writeFileSync(join(worldDir, hash + ext), bytes);
    this.db
      .insert(assets)
      .values({
        hash,
        worldId,
        originalFilename: filename,
        mime: MIME_BY_EXT[ext] ?? 'application/octet-stream',
        size: bytes.length,
        createdAt: Date.now(),
      })
      .run();
    return { url: assetUrl(worldId, hash, ext), hash, deduped: false };
  }

  /**
   * Read a stored Asset's bytes and content type for serving (ADR-0034), or null if it is
   * absent. Path-traversal-safe: `worldId`/`file` that aren't a single path segment (a `/`,
   * `\`, or `..` slipped through URL decoding) are rejected as not-found rather than allowed
   * to escape the Asset root.
   */
  read(worldId: string, file: string): { bytes: Buffer; mime: string } | null {
    if (basename(worldId) !== worldId || basename(file) !== file) return null;
    const path = join(this.dir, worldId, file);
    if (!existsSync(path)) return null;
    return { bytes: readFileSync(path), mime: MIME_BY_EXT[extname(file).toLowerCase()] ?? 'application/octet-stream' };
  }

  /**
   * Every stored Asset for a World, for the vault export (ADR-0033, #150): the capability URL its
   * docs reference (built by the same {@link url} helper the store path uses, so the export's src
   * rewrite can't drift from the stored format), the human-readable `originalFilename` to write
   * into the zip, and its bytes. A row whose file is missing on disk is skipped rather than
   * aborting the export.
   */
  exportAssets(worldId: string): { servedUrl: string; originalFilename: string; bytes: Buffer }[] {
    const rows = this.db
      .select({ hash: assets.hash, originalFilename: assets.originalFilename })
      .from(assets)
      .where(eq(assets.worldId, worldId))
      .all();
    const out: { servedUrl: string; originalFilename: string; bytes: Buffer }[] = [];
    for (const row of rows) {
      const ext = extname(row.originalFilename).toLowerCase();
      const found = this.read(worldId, row.hash + ext);
      if (found) out.push({ servedUrl: assetUrl(worldId, row.hash, ext), originalFilename: row.originalFilename, bytes: found.bytes });
    }
    return out;
  }

  /** Remove a World's entire Asset folder (its rows cascade away with the World). Best-effort: a missing folder is fine. */
  deleteWorld(worldId: string): void {
    rmSync(join(this.dir, worldId), { recursive: true, force: true });
  }
}
