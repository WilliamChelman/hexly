import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { AssetSummary, assetUrl, EntityDocument, entityDocumentSchema, THUMBNAIL_SUFFIX } from '@hexly/domain';
import { assetSummaryOf, readAssetValue } from '@hexly/plugin-asset';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DB, Db } from '../db/db';
import { assetIndex, entities, entityEdges } from '../db/schema';
import { AssetBytesRegistry } from '../entities/asset-bytes-registry';
import { DeletedEntity, EntityDeletionRegistry } from '../entities/entity-deletion-registry';
import { edgeTargetContainerId } from '../entities/utils/asset-edge-target';

/** DI token for the on-disk Assets root, resolved by `resolveAssetsDir` (ADR-0034). */
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

/**
 * One Asset as the Vault export writes it: the capability URL its docs reference (the key the export's
 * `srcMap` repoints), the human-readable `name + ext` the zip entry takes, and the bytes themselves.
 */
export interface ExportAsset {
  readonly servedUrl: string;
  readonly originalFilename: string;
  readonly bytes: Buffer;
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
 * route relies on. Dedup and enumeration are the **Asset Entity's** job, resolved through the derived
 * `(containerId, hash) → entity` index (ADR-0065); byte serving reads disk with no table consulted.
 */
@Injectable()
export class AssetsService implements OnModuleInit {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ASSETS_DIR) private readonly dir: string,
    private readonly deletions: EntityDeletionRegistry,
    private readonly assetBytes: AssetBytesRegistry,
  ) {}

  /**
   * Register the Asset byte reaper on the Entity deletion hooks (ADR-0065): deleting an Asset Entity is the
   * ordinary Entity delete, and this is what makes it take the bytes/thumbnail with it. `EntityWrites` fires
   * it post-commit; dedup guarantees one Entity per hash, so the bytes are safely orphaned once it is gone.
   *
   * And the byte-presence probe (#325): this service alone knows the resolved Assets root, so `entities`
   * never learns what an Asset is.
   */
  onModuleInit(): void {
    this.deletions.register((deleted) => this.reap(deleted));
    this.assetBytes.register((worldId, hash, ext) => this.bytesPresent(worldId, hash, ext));
  }

  /**
   * Whether an Asset's bytes are on disk (#325, ADR-0034): one stat at the hash-derived path, cheap enough to
   * run per read. The regenerable thumbnail is deliberately not consulted, and an address that is not a
   * single path segment reads as "not there", as in {@link read}.
   */
  bytesPresent(worldId: string, hash: string, ext: string): boolean {
    const file = hash + ext;
    if (basename(worldId) !== worldId || basename(file) !== file) return false;
    return existsSync(join(this.dir, worldId, file));
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
   * `(containerId, hash)` dedup decides whether a new Entity is minted. `filename` supplies the extension
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
   * Every Asset a World's vault export writes (ADR-0033, ADR-0065): the capability URL its docs
   * reference, the human-readable `name + ext` to write into the zip, and its bytes. The World's own
   * Asset Entities first, then the foreign ones its documents draw on from a Container it **Mounts**,
   * flattened in so the archive opens without broken pictures (ADR-0080).
   *
   * Own-first is what keeps a World that draws on nothing entry-for-entry the archive it was: it has no
   * foreign edges, so the second list is empty. An Entity in **Missing Bytes** is left out rather than
   * aborting the export.
   */
  exportAssets(worldId: string): ExportAsset[] {
    const out: ExportAsset[] = [];
    for (const { containerId, name, value } of [...this.assetEntities(worldId), ...this.foreignAssets(worldId)]) {
      const found = this.read(containerId, value.hash + value.ext);
      if (found) {
        // One home for the served-URL + `name + ext` derivation: the picker's {@link assetSummaryOf}.
        const summary = assetSummaryOf(containerId, name, value);
        out.push({ servedUrl: summary.url, originalFilename: summary.originalFilename, bytes: found.bytes });
      }
    }
    return out;
  }

  /**
   * Turn already-matched Asset Entities into {@link AssetSummary}s — the picker source (#269, ADR-0065,
   * #281). The Board image picker searches through the one entity-search machinery (pinned to the asset
   * type + image kind), which yields ordered `{ id, name }` rows; this reads each one's asset-ref off its
   * document to attach the capability URL, thumbnail, `mime` and `size` the picker draws. Metadata only,
   * no disk read; the caller's order is preserved (relevance under a query), and a row whose document
   * carries no readable asset-ref (a placeholder this build cannot parse) is dropped forward-only.
   */
  summariesFor(worldId: string, matches: readonly { id: string; name: string }[]): AssetSummary[] {
    if (matches.length === 0) return [];
    const docs = new Map<string, string>();
    for (const row of this.db
      .select({ id: entities.id, document: entities.document })
      .from(entities)
      .where(inArray(entities.id, [...new Set(matches.map((m) => m.id))]))
      .all())
      docs.set(row.id, row.document);
    const out: AssetSummary[] = [];
    for (const match of matches) {
      const raw = docs.get(match.id);
      const value = raw ? assetRefOf(raw) : null;
      if (value) out.push(assetSummaryOf(worldId, match.name, value));
    }
    return out;
  }

  /**
   * The World's Asset Entities' names and asset-ref values, joined off the derived dedup index (ADR-0065)
   * — the source {@link exportAssets} enumerates.
   */
  private assetEntities(worldId: string): AssetEntityRow[] {
    return readAssetRefs(
      this.db
        .select({ containerId: assetIndex.containerId, name: entities.name, document: entities.document })
        .from(assetIndex)
        .innerJoin(entities, eq(entities.id, assetIndex.entityId))
        .where(eq(assetIndex.containerId, worldId))
        .orderBy(asc(entities.createdAt), asc(assetIndex.hash))
        .all(),
    );
  }

  /**
   * The Asset Entities this World's `asset` edges name in another Container — the second half of what
   * {@link exportAssets} writes. Read off the edges, which carry the Container their URL named (#407),
   * never through the **Mount** set, exactly as the harvest does not: unmounting stops a link being
   * *followed*, it does not stop the bytes rendering, so dropping them the moment a Mount went away would
   * lose pictures the page still shows (ADR-0080).
   *
   * Distinct because one image referenced by twenty notes is one set of bytes, and ordered by its address
   * so an archive is reproducible. An edge whose Container holds no such Asset is already dangling and
   * drops on the join: there is nothing to flatten.
   */
  private foreignAssets(worldId: string): AssetEntityRow[] {
    return readAssetRefs(
      this.db
        .selectDistinct({ containerId: assetIndex.containerId, name: entities.name, document: entities.document })
        .from(entityEdges)
        .innerJoin(
          assetIndex,
          and(sql`${assetIndex.containerId} = ${edgeTargetContainerId}`, eq(assetIndex.hash, entityEdges.targetId)),
        )
        .innerJoin(entities, eq(entities.id, assetIndex.entityId))
        .where(
          and(
            eq(entityEdges.containerId, worldId),
            eq(entityEdges.targetKind, 'asset'),
            sql`${edgeTargetContainerId} <> ${worldId}`,
          ),
        )
        .orderBy(asc(assetIndex.containerId), asc(assetIndex.hash))
        .all(),
    );
  }

  /** Remove a World's entire Asset folder (its index rows cascade away with the World). Best-effort: a missing folder is fine. */
  deleteWorld(worldId: string): void {
    rmSync(join(this.dir, worldId), { recursive: true, force: true });
  }
}

/** One Asset Entity resolved for the export: where its bytes live, what to call them, and their address. */
interface AssetEntityRow {
  readonly containerId: string;
  readonly name: string;
  readonly value: AssetRef;
}

type AssetRef = NonNullable<ReturnType<typeof readAssetValue>>;

/** The asset-ref a stored document carries, or null — a placeholder this build cannot parse reads as absent. */
function assetRefOf(document: string): AssetRef | null {
  const parsed = entityDocumentSchema.safeParse(JSON.parse(document) as EntityDocument);
  return parsed.success ? readAssetValue(parsed.data) : null;
}

/** Resolve each queried row's asset-ref; one carrying none is skipped forward-only. */
function readAssetRefs(rows: readonly { containerId: string; name: string; document: string }[]): AssetEntityRow[] {
  const out: AssetEntityRow[] = [];
  for (const row of rows) {
    const value = assetRefOf(row.document);
    if (value) out.push({ containerId: row.containerId, name: row.name, value });
  }
  return out;
}
