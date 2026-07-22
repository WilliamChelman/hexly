import { createHash } from 'node:crypto';
import { basename, extname } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { emptyEntityDocument, EntityDetail, EntityDocument, nameSchema } from '@hexly/domain';
import {
  ASSET_FIELD_ID,
  assetValueUrl,
  CORE_ASSET_TYPE_ID,
  readAssetValue,
  type AssetValue,
} from '@hexly/plugin-asset';
import { and, eq } from 'drizzle-orm';
import { DB, Db } from '../db/db';
import { assetIndex } from '../db/schema';
import { EntitiesService } from '../entities/entities.service';
import { EntityWrites } from '../entities/entity-writes';
import { TypeFieldRegistry } from '../entities/type-field-registry';
import { WorldTypeFields } from '../entities/world-type-fields';
import { AssetsService } from './assets.service';

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
 * name sticks), resolved reconcile-style through the derived `(worldId, hash) → entity` index.
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
  ) {}

  /**
   * Mint (or dedup to) an Asset for `bytes` uploaded under `filename` into `worldId`, owned by `ownerId`.
   * Keyed on `(worldId, hash)`: identical bytes already wrapped in this World return that Entity untouched
   * — the on-disk bytes and served URL are content-addressed, so nothing is written and the first name
   * sticks. A fresh mint pins the extension in the asset-ref, so a later rename never moves the URL.
   */
  mint(ownerId: string, worldId: string, filename: string, bytes: Uint8Array): MintedAsset {
    const hash = createHash('sha256').update(bytes).digest('hex');
    const existing = this.db
      .select({ entityId: assetIndex.entityId })
      .from(assetIndex)
      .where(and(eq(assetIndex.worldId, worldId), eq(assetIndex.hash, hash)))
      .get();
    if (existing) {
      const entity = this.entities.detailById(existing.entityId);
      // Index and Entity are written in one transaction, so a row here means the Entity exists.
      if (entity) {
        const value = readAssetValue(entity.document);
        if (value) return { entity, url: assetValueUrl(worldId, value), deduped: true };
      }
    }

    // No twin: write the bytes and mint the wrapper. `store` re-derives the same hash and pins the
    // lower-cased extension on disk and in the URL.
    const stored = this.assets.store(worldId, filename, bytes);
    const assetValue: AssetValue = {
      hash: stored.hash,
      ext: stored.ext,
      mime: stored.mime,
      size: bytes.length,
      // Stats extraction (sharp) lands in its own ticket (ADR-0065); the ref mints statless for now.
      stats: null,
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
      worldId,
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
}
