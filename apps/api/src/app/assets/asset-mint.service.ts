import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { emptyEntityDocument, EntityDetail, EntityDocument, EntityType, nameSchema } from '@hexly/domain';
import {
  ASSET_FIELD_ID,
  assetValueUrl,
  CORE_ASSET_TYPE_ID,
  readAssetValue,
  type AssetValue,
} from '@hexly/plugin-asset';
import { and, eq } from 'drizzle-orm';
import { DB, Db } from '../db/db';
import { entityAccess } from '../acl/entity-access';
import { assetIndex } from '../db/schema';
import { EntitiesService } from '../entities/entities.service';
import { EntityWrites } from '../entities/entity-writes';
import { TypeFieldRegistry } from '../entities/type-field-registry';
import { WorldTypeFields } from '../entities/world-type-fields';
import { AssetExtraction, AssetExtractionService } from './asset-extraction.service';
import { AssetsService, mimeForExt } from './assets.service';

/** What a mint-and-dedup produced: the wrapper Asset Entity, its served capability URL, and whether it deduped. */
export interface MintedAsset {
  readonly entity: EntityDetail;
  readonly url: string;
  readonly deduped: boolean;
}

/**
 * Mint-and-dedup on upload (ADR-0065): an uploaded file becomes an **Asset** — an Entity carrying
 * `core.type.asset`, named after the filename stem, with the uploader as sole Owner and visibility
 * `shared`. Re-uploading identical bytes to the same World returns the existing Asset (no twin; the first
 * name sticks), resolved reconcile-style through the derived `(containerId, hash) → entity` index.
 *
 * The gate (Contributor) lives at the caller (`WorldsService.uploadAsset`); this service is the pure mint.
 */
@Injectable()
export class AssetMintService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly assets: AssetsService,
    private readonly writes: EntityWrites,
    private readonly entities: EntitiesService,
    private readonly worldTypeFields: WorldTypeFields,
    private readonly typeFields: TypeFieldRegistry,
    private readonly extraction: AssetExtractionService,
  ) {}

  /**
   * Derive the **Asset Stats** and thumbnail for `bytes` uploaded under `filename` (ADR-0065), keyed by the
   * mime the extension names. Async because the image extractor (sharp) has no sync API, so a caller inside
   * a synchronous mint transaction (the vault import) runs this first and passes the result into {@link mint}.
   * Best-effort: unparseable or unrecognised bytes resolve to a statless, thumbnail-less extraction.
   */
  extract(filename: string, bytes: Uint8Array): Promise<AssetExtraction> {
    return this.extraction.extract(mimeForExt(extname(filename)), bytes);
  }

  /**
   * Mint (or dedup to) an Asset for `bytes` uploaded under `filename` into `worldId`, owned by `ownerId`,
   * with the pre-computed {@link AssetExtraction} written in. Keyed on `(containerId, hash)`: identical bytes
   * already wrapped in this World return that Entity untouched — the on-disk bytes and served URL are
   * content-addressed, so nothing is written (not even a re-extraction) and the first name sticks. A fresh
   * mint pins the extension in the asset-ref, folds the stats into it, and stores the thumbnail beside the
   * bytes, so a later rename never moves the URL.
   */
  mint(
    ownerId: string,
    worldId: string,
    filename: string,
    bytes: Uint8Array,
    extraction: AssetExtraction,
  ): MintedAsset {
    const hash = createHash('sha256').update(bytes).digest('hex');
    const existing = this.db
      .select({ entityId: assetIndex.entityId })
      .from(assetIndex)
      .where(and(eq(assetIndex.containerId, worldId), eq(assetIndex.hash, hash)))
      .get();
    if (existing) {
      const entity = this.entities.detailById(existing.entityId);
      // Index and Entity are written in one transaction, so a row here means the Entity exists.
      if (entity) {
        const value = readAssetValue(entity.document);
        if (value) {
          // Whether the uploader may *read* the twin decides what the dedup echoes. A readable hit (own
          // or `shared`) comes back whole — the first name sticks (ADR-0065). A hit the uploader cannot
          // read is someone else's `private` Asset, so ADR-0046 (private is indistinguishable from
          // missing) forbids echoing its curated name/prose/Tags/visibility: hand back a redacted,
          // fresh-mint-shaped wrapper carrying only the served URL.
          const canRead = entityAccess(this.db, ownerId).decideMeta(existing.entityId)?.canRead;
          const dedup = canRead ? entity : this.redactedDedup(entity.id, worldId, filename, value);
          return { entity: dedup, url: assetValueUrl(worldId, value), deduped: true };
        }
      }
    }

    // No twin: write the bytes and mint the wrapper. `store` re-derives the same hash and pins the
    // lower-cased extension on disk and in the URL.
    const stored = this.assets.store(worldId, filename, bytes);
    // A minted thumbnail is a regenerable cache beside the bytes (ADR-0065): absent when extraction found
    // none (a non-image, or bytes sharp could not parse), when the original serves as the fallback.
    if (extraction.thumbnail) this.assets.storeThumbnail(worldId, stored.hash, extraction.thumbnail);
    const assetValue: AssetValue = {
      hash: stored.hash,
      ext: stored.ext,
      mime: stored.mime,
      size: bytes.length,
      // The mechanical Asset Stats extraction wrote (ADR-0065), or null when it could not parse the bytes.
      stats: extraction.stats,
    };
    // Seed the asset-ref over the type's minted defaults (its Content opens empty), like a plain create.
    const seed: EntityDocument = { [ASSET_FIELD_ID]: assetValue };
    const fields = this.worldTypeFields.effectiveFields(worldId, [CORE_ASSET_TYPE_ID], seed);
    const doc: EntityDocument = {
      ...emptyEntityDocument(fields, this.typeFields.structuredDataTypes),
      [ASSET_FIELD_ID]: assetValue,
    };
    const rawExt = extname(filename);
    const name = nameSchema.catch('Asset').parse(basename(filename, rawExt));
    const row = this.writes.insert({
      ownerId,
      containerId: worldId,
      name,
      types: [CORE_ASSET_TYPE_ID],
      tags: [],
      document: doc,
      // You upload for the World, not just your own picker (ADR-0065): default visibility `shared`.
      visibility: 'shared',
    });
    const entity = this.entities.detailById(row.id);
    if (!entity) throw new Error(`Minted Asset ${row.id} could not be reloaded`);
    return { entity, url: assetValueUrl(worldId, assetValue), deduped: false };
  }

  /**
   * The wrapper a dedup hands back when the uploader cannot read the twin — a `private` Asset owned by
   * someone else (ADR-0046: private is indistinguishable from missing; ADR-0065: `private` = "only in the
   * uploader's picker"). It echoes none of that Entity's curated metadata: it is shaped like a fresh mint
   * of the uploader's own bytes — the filename-stem `name`, empty Tags, default `shared`, the type's empty
   * document — carrying only the content-addressed asset-ref, whose `hash`/`ext`/`stats` are derived from
   * the identical bytes the uploader just supplied (so not a leak) and whose served URL (capability-served,
   * ADR-0034) still resolves for the Board picker. The real id rides along as a handle (access-checked on
   * every other route); the timing/version fields are synthesised, never read from the private row.
   */
  private redactedDedup(id: string, worldId: string, filename: string, value: AssetValue): EntityDetail {
    const now = Date.now();
    const name = nameSchema.catch('Asset').parse(basename(filename, extname(filename)));
    const seed: EntityDocument = { [ASSET_FIELD_ID]: value };
    const fields = this.worldTypeFields.effectiveFields(worldId, [CORE_ASSET_TYPE_ID], seed);
    const document: EntityDocument = {
      ...emptyEntityDocument(fields, this.typeFields.structuredDataTypes),
      [ASSET_FIELD_ID]: value,
    };
    return {
      id,
      worldId,
      name,
      types: [CORE_ASSET_TYPE_ID as EntityType],
      tags: [],
      visibility: 'shared',
      version: 1,
      seq: 0,
      document,
      createdAt: now,
      updatedAt: now,
    };
  }
}
