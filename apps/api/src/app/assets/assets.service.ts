import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { AssetSummary, assetUrl, EntityDocument, entityDocumentSchema, THUMBNAIL_SUFFIX } from '@hexly/domain';
import { assetSummaryOf, readAssetValue } from '@hexly/plugin-asset';
import { asc, eq } from 'drizzle-orm';
import { DB, Db } from '../db/db';
import { assetIndex, entities } from '../db/schema';
import { DeletedEntity, EntityDeletionRegistry } from '../entities/entity-deletion-registry';

/** DI token for the on-disk Assets root (`<instanceDir>/assets`, or a temp dir for `:memory:`). */
export const ASSETS_DIR = Symbol('ASSETS_DIR');

/**
 * Content type by lower-cased file extension, for the Asset kinds a vault carries (ADR-0034: images,
 * PDFs). Anything unlisted serves as a generic download.
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

/** The content type a filename's extension serves as (ADR-0034); unlisted extensions are a generic download. */
export function mimeForExt(ext: string): string {
  return MIME_BY_EXT[ext.toLowerCase()] ?? 'application/octet-stream';
}

/** What {@link AssetsService.store} tells the mint path: the capability URL and the bytes' content hash. */
export interface StoredAsset {
  readonly url: string;
  readonly hash: string;
  readonly ext: string;
  readonly mime: string;
}

/**
 * Per-World content-addressed Asset byte storage (ADR-0034, ADR-0065). Bytes are written to disk under
 * `<ASSETS_DIR>/<worldId>/<sha256>.<ext>`; the hash IS the capability token the unauthenticated serving
 * route relies on. Dedup and enumeration are the **Asset Entity's** job now — the `assets` table dissolved
 * into the derived `(worldId, hash) → entity` index, and byte serving reads disk with no table consulted.
 */
@Injectable()
export class AssetsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ASSETS_DIR) private readonly dir: string,
    private readonly deletions: EntityDeletionRegistry,
  ) {}

  /**
   * Register the Asset byte reaper on the Entity deletion hooks (ADR-0065): deleting an Asset Entity is the
   * ordinary Entity delete, and this is what makes it take the bytes/thumbnail with it. `EntityWrites` fires
   * it post-commit; dedup guarantees one Entity per hash, so the bytes are safely orphaned once it is gone.
   */
  onModuleInit(): void {
    this.deletions.register((deleted) => this.reap(deleted));
  }

  /**
   * Reap a deleted Entity's Asset bytes (ADR-0065). A non-Asset (no readable asset-ref) reaps nothing; a
   * placeholder ref this build cannot parse reads as absent and is left alone (forward-only). The bytes go
   * content-addressed by hash — the pinned `ext` locates the original beside its thumbnail.
   */
  private reap(deleted: DeletedEntity): void {
    const value = readAssetValue(deleted.document);
    if (value) this.deleteBytes(deleted.worldId, value.hash, value.ext);
  }

  /**
   * Remove an Asset's stored bytes and its thumbnail cache (ADR-0065). Best-effort and idempotent (`force`),
   * so a missing file — a re-run reap, a thumbnail that was never minted — is a no-op. Path-traversal-safe:
   * a `worldId`/`hash` that is not a single path segment is refused, never allowed to escape the Asset root.
   */
  deleteBytes(worldId: string, hash: string, ext: string): void {
    if (basename(worldId) !== worldId || basename(hash) !== hash) return;
    const worldDir = join(this.dir, worldId);
    rmSync(join(worldDir, hash + ext), { force: true });
    rmSync(join(worldDir, hash + THUMBNAIL_SUFFIX), { force: true });
  }

  /**
   * Write `bytes` for `worldId`, content-addressed by their sha256 (ADR-0034). Idempotent: identical
   * bytes hash to the same on-disk name, so a repeat overwrites a byte-identical file — the mint path's
   * `(worldId, hash)` dedup decides whether a new Entity is minted. `filename` supplies the extension
   * (on disk and in the URL), pinned at first store so the served URL is stable across renames (ADR-0065).
   */
  store(worldId: string, filename: string, bytes: Uint8Array): StoredAsset {
    const hash = createHash('sha256').update(bytes).digest('hex');
    const ext = extname(filename).toLowerCase();
    const worldDir = join(this.dir, worldId);
    mkdirSync(worldDir, { recursive: true });
    writeFileSync(join(worldDir, hash + ext), bytes);
    return { url: assetUrl(worldId, hash, ext), hash, ext, mime: mimeForExt(ext) };
  }

  /**
   * Store a minted thumbnail beside its source bytes at the hash-derived {@link THUMBNAIL_SUFFIX} path
   * (ADR-0065). A thumbnail is a regenerable cache — no row, no identity — so nothing but the file records
   * it; it is served on the same route as the bytes and deleted with its World's folder.
   */
  storeThumbnail(worldId: string, hash: string, bytes: Uint8Array): void {
    const worldDir = join(this.dir, worldId);
    mkdirSync(worldDir, { recursive: true });
    writeFileSync(join(worldDir, hash + THUMBNAIL_SUFFIX), bytes);
  }

  /**
   * Read a stored Asset's bytes and content type for serving (ADR-0034), or null if it is
   * absent. Path-traversal-safe: `worldId`/`file` that aren't a single path segment (a `/`,
   * `\`, or `..` slipped through URL decoding) are rejected as not-found rather than allowed
   * to escape the Asset root.
   *
   * A thumbnail request (`<hash>${THUMBNAIL_SUFFIX}`) whose thumbnail was never minted — a non-image, or
   * an upload sharp could not parse — falls back to the original bytes (ADR-0065), so a grid pointed at
   * the thumbnail URL always renders something rather than 404ing.
   */
  read(worldId: string, file: string): { bytes: Buffer; mime: string } | null {
    if (basename(worldId) !== worldId || basename(file) !== file) return null;
    const path = join(this.dir, worldId, file);
    if (existsSync(path)) return { bytes: readFileSync(path), mime: mimeForExt(extname(file)) };
    return this.originalForThumbnail(worldId, file);
  }

  /**
   * The original bytes a missing thumbnail request falls back to (ADR-0065): for a `<hash>${THUMBNAIL_SUFFIX}`
   * path, the one stored `<hash>.<ext>` sibling. Null for any other missing file, so a genuine miss stays a
   * 404.
   */
  private originalForThumbnail(worldId: string, file: string): { bytes: Buffer; mime: string } | null {
    if (!file.endsWith(THUMBNAIL_SUFFIX)) return null;
    const hash = file.slice(0, -THUMBNAIL_SUFFIX.length);
    if (!/^[0-9a-f]{64}$/.test(hash)) return null;
    const worldDir = join(this.dir, worldId);
    if (!existsSync(worldDir)) return null;
    const original = readdirSync(worldDir).find((f) => f.startsWith(`${hash}.`) && !f.endsWith(THUMBNAIL_SUFFIX));
    if (!original) return null;
    return { bytes: readFileSync(join(worldDir, original)), mime: mimeForExt(extname(original)) };
  }

  /**
   * Every Asset for a World, for the vault export (ADR-0033, ADR-0065): the capability URL its docs
   * reference, the human-readable `name + ext` to write into the zip, and its bytes. Derived from the
   * Asset Entities (their asset-ref) via the dedup index — no `assets` table. An Entity whose bytes are
   * missing on disk is skipped rather than aborting the export.
   */
  exportAssets(worldId: string): { servedUrl: string; originalFilename: string; bytes: Buffer }[] {
    const out: { servedUrl: string; originalFilename: string; bytes: Buffer }[] = [];
    for (const { name, value } of this.assetEntities(worldId)) {
      const found = this.read(worldId, value.hash + value.ext);
      if (found)
        out.push({
          servedUrl: assetUrl(worldId, value.hash, value.ext),
          originalFilename: `${name}${value.ext}`,
          bytes: found.bytes,
        });
    }
    return out;
  }

  /**
   * Every Asset in a World as an {@link AssetSummary} — the picker source a Board Image or Content
   * references (#269, ADR-0034, ADR-0065). Metadata only (no disk read): the capability URL plus the
   * `mime`/`size`/`name + ext` the Asset Entity's asset-ref carries. Ordered by the Entity's `createdAt`
   * then `hash` for a stable list.
   */
  list(worldId: string): AssetSummary[] {
    return this.assetEntities(worldId).map(({ name, value }) => assetSummaryOf(worldId, name, value));
  }

  /**
   * The World's Asset Entities' names and asset-ref values, joined off the derived dedup index (ADR-0065)
   * — the shared source for {@link list} and {@link exportAssets}. An Entity whose document carries no
   * readable asset-ref (a placeholder ref this build cannot parse) is skipped forward-only.
   */
  private assetEntities(worldId: string): { name: string; value: NonNullable<ReturnType<typeof readAssetValue>> }[] {
    const rows = this.db
      .select({ name: entities.name, document: entities.document, hash: assetIndex.hash })
      .from(assetIndex)
      .innerJoin(entities, eq(entities.id, assetIndex.entityId))
      .where(eq(assetIndex.worldId, worldId))
      .orderBy(asc(entities.createdAt), asc(assetIndex.hash))
      .all();
    const out: { name: string; value: NonNullable<ReturnType<typeof readAssetValue>> }[] = [];
    for (const row of rows) {
      const parsed = entityDocumentSchema.safeParse(JSON.parse(row.document) as EntityDocument);
      const value = parsed.success ? readAssetValue(parsed.data) : null;
      if (value) out.push({ name: row.name, value });
    }
    return out;
  }

  /** Remove a World's entire Asset folder (its index rows cascade away with the World). Best-effort: a missing folder is fine. */
  deleteWorld(worldId: string): void {
    rmSync(join(this.dir, worldId), { recursive: true, force: true });
  }
}
